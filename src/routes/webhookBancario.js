'use strict';

const express = require('express');
const router = express.Router();
const { QueryTypes } = require('sequelize');
const { waitUntil } = require('@vercel/functions');

const postgres = require('../database/postgres');
const bankingProviderRegistry = require('../integrations/bankingProviderRegistry');
const webhookLogRepository = require('../integrations/shared/webhookLogRepository');
const cobrancaBancariaRepository = require('../integrations/shared/cobrancaBancariaRepository');
const cronQueueKeyGuard = require('../helpers/cronQueueKeyGuard');
const crypto = require('crypto');
const { reconciliarCobrancasBancarias, normalizarSituacaoProvider } = require('../task/reconciliarCobrancasBancarias');
const { registrarAuditoria } = require('../helpers/auditoria');

const HEADERS_SENSIVEIS = new Set(['authorization', 'cookie', 'x-webhook-secret', 'x-cron-queue-key', 'x-access-token']);

function _headersParaLog(headers) {
  const saida = {};
  for (const [chave, valor] of Object.entries(headers || {})) {
    saida[chave] = HEADERS_SENSIVEIS.has(String(chave).toLowerCase()) ? '[omitido]' : valor;
  }
  return saida;
}

// Segredo opcional na URL cadastrada no banco (…/inter?k=<segredo>) ou no
// header X-Webhook-Secret. Se WEBHOOK_BANCARIO_SECRET estiver definida, passa
// a ser obrigatório. O Inter não assina o payload, então isto só reduz ruído:
// a proteção real é a reconsulta da cobrança no banco (ver _processarEvento).
function _webhookSecretGuard(req, res, next) {
  const esperado = process.env.WEBHOOK_BANCARIO_SECRET;
  if (!esperado) {
    return next();
  }
  const recebido = String(req.query?.k || req.header('x-webhook-secret') || '');
  const a = crypto.createHash('sha256').update(esperado).digest();
  const b = crypto.createHash('sha256').update(recebido).digest();
  if (!recebido || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ message: 'Não autorizado.' });
  }
  return next();
}

/**
 * Rede de segurança do webhook: reconsulta no banco toda cobrança "emitida"
 * há mais de 30 min e aplica a situação real. Precisa ser chamada por um
 * cron externo (header X-Cron-Queue-Key) — o node-cron de
 * reconciliarCobrancasBancarias.js não roda na Vercel serverless.
 * Declarada ANTES de '/:provider' para não ser capturada por ela.
 */
router.post('/reconciliar', cronQueueKeyGuard, async (req, res) => {
  try {
    const resumo = await reconciliarCobrancasBancarias();
    return res.status(200).json(resumo);
  } catch (err) {
    return res.status(500).json({ message: 'Falha na reconciliação de cobranças.', detail: err.message });
  }
});

/**
 * Rota pública (sem middleware `auth`) — é chamada pelo banco, não por um
 * usuário logado. O Inter não assina o payload (sem HMAC/Bearer), por isso o
 * payload é tratado apenas como AVISO: a situação aplicada é sempre a
 * devolvida pela API do banco na reconsulta (consultarCobranca), nunca a do
 * corpo recebido. Ver interWebhookHandler.js para o detalhe do payload real.
 */
router.post('/:provider', _webhookSecretGuard, async (req, res) => {
  const { provider } = req.params;

  // Gravação ANTES de processar — auditoria garantida mesmo que o
  // processamento abaixo falhe ou a invocação serverless seja cortada.
  const logId = await webhookLogRepository.registrar({
    provider,
    payloadBruto: JSON.stringify(req.body),
    headersRecebidos: JSON.stringify(_headersParaLog(req.headers)),
    ipOrigem: req.ip,
  });

  // Responde rápido — o provider tem sua própria política de retry/timeout
  // em cima deste endpoint; confirmamos recebimento e processamos depois
  // (mesmo padrão de waitUntil pós-resposta já usado em financeiroController).
  res.status(200).json({ recebido: true });

  waitUntil((async () => {
    try {
      const eventos = await bankingProviderRegistry.getProvider(provider).processarWebhook(null, req.body);

      for (const evento of eventos) {
        await _processarEvento({ provider, logId, evento });
      }

      await webhookLogRepository.marcarProcessado(logId, { status: 'processado' });
    } catch (err) {
      await webhookLogRepository.marcarProcessado(logId, { status: 'erro', erroDetalhe: err.message });
    }
  })());
});

/**
 * @param {object} params
 * @param {string} params.provider
 * @param {number} params.logId
 * @param {{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}} params.evento
 */
async function _processarEvento({ provider, logId, evento }) {
  const { idExterno, situacao: situacaoInformada } = evento;

  const [linha] = await postgres.query(
    `SELECT cb.id AS id_cobranca, cb.id_condominio, cb.id_receita, cb.provider AS cb_provider,
            cb.situacao, cb.id_externo,
            ib.*
       FROM "condominio-bh".tb_fin_cobranca_bancaria cb
       JOIN "condominio-bh".tb_fin_integracao_bancaria ib ON ib.id = cb.id_integracao_bancaria
      WHERE cb.provider = :provider AND cb.id_externo = :idExterno
      LIMIT 1`,
    { replacements: { provider, idExterno }, type: QueryTypes.SELECT }
  );

  if (!linha) {
    // Cobrança emitida fora deste sistema (ex: manual no Internet Banking)
    // ou ainda não persistida — nada a atualizar aqui além do log.
    await webhookLogRepository.marcarProcessado(logId, { status: 'ignorado', eventoTipo: evento.tipoEvento, idExterno });
    return;
  }

  const cobranca = {
    id: linha.id_cobranca,
    id_condominio: linha.id_condominio,
    id_receita: linha.id_receita,
    provider: linha.cb_provider,
    situacao: linha.situacao,
  };

  // Situação final já aplicada: não reconsulta (evita usar o webhook para
  // gerar chamadas em massa à API do banco).
  if (cobranca.situacao === 'paga' || cobranca.situacao === 'cancelada') {
    await webhookLogRepository.marcarProcessado(logId, {
      status: 'ignorado', eventoTipo: evento.tipoEvento, idExterno, idCondominio: cobranca.id_condominio,
    });
    return;
  }

  // Fonte de verdade: a API do banco, com a credencial da integração DA
  // PRÓPRIA cobrança (nunca de outro condomínio).
  const detalhado = await bankingProviderRegistry
    .getProvider(cobranca.provider)
    .consultarCobranca(linha, linha.id_externo);
  const situacaoReal = normalizarSituacaoProvider(detalhado?.cobranca?.situacao);
  const eventoTipoReal = `cobranca.${situacaoReal}`;

  if (situacaoInformada && situacaoInformada !== situacaoReal) {
    console.warn(
      `[webhook-bancario] Payload divergente da API do banco: cobranca=${cobranca.id} informado=${situacaoInformada} real=${situacaoReal}`
    );
  }

  const atualizou = await cobrancaBancariaRepository.aplicarSituacao(cobranca, situacaoReal);

  await webhookLogRepository.marcarProcessado(logId, {
    status: 'processado',
    eventoTipo: eventoTipoReal,
    idExterno,
    idCondominio: cobranca.id_condominio,
  });

  if (atualizou) {
    await registrarAuditoria({
      acao: 'cobranca_situacao_webhook',
      entidade: 'cobranca_bancaria',
      entidadeId: cobranca.id,
      idCondominio: cobranca.id_condominio,
      detalhes: { provider, situacao_informada: situacaoInformada, situacao_aplicada: situacaoReal, id_receita: cobranca.id_receita },
    });
  }
}

module.exports = router;
