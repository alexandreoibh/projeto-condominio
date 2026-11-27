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

// ─── Segurança do webhook (auditoria 27/11/2026, F3) ─────────────────────────
// Fail-closed: desativado por padrão. Só processa se TODAS valerem:
//   WEBHOOK_BANCARIO_HABILITADO=true, provider listado em
//   WEBHOOK_BANCARIO_PROVIDERS, validador de contrato para o provider e
//   WEBHOOK_BANCARIO_SECRET com >= 32 caracteres, enviado no header
//   X-Webhook-Secret (nunca na query string).
// O mecanismo oficial de autenticação do webhook do Inter (provável mTLS) não
// foi confirmado; reativação: ver docs/seguranca/webhook-bancario-reativacao.md.
const MAX_PAYLOAD_BYTES = 32 * 1024;
const MIN_TAMANHO_SEGREDO = 32;
const VALIDADORES_PAYLOAD = {
  inter: require('../integrations/inter/interWebhookHandler').validarPayload,
};

function _providersHabilitados() {
  if (String(process.env.WEBHOOK_BANCARIO_HABILITADO || '').trim().toLowerCase() !== 'true') return new Set();
  return new Set(
    String(process.env.WEBHOOK_BANCARIO_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
  );
}

function _segredoConfigurado() {
  const segredo = String(process.env.WEBHOOK_BANCARIO_SECRET || '');
  return segredo.length >= MIN_TAMANHO_SEGREDO ? segredo : null;
}

function _webhookGuard(req, res, next) {
  const provider = String(req.params.provider || '');
  const segredo = _segredoConfigurado();
  const habilitado = segredo
    && _providersHabilitados().has(provider)
    && bankingProviderRegistry.listarProvidersDisponiveis().includes(provider)
    && typeof VALIDADORES_PAYLOAD[provider] === 'function';
  // Desativado/mal configurado: mesma resposta de rota inexistente, sem gravar nada.
  if (!habilitado) return res.status(404).json({ message: 'Não encontrado.' });

  const recebido = String(req.header('x-webhook-secret') || '');
  const a = crypto.createHash('sha256').update(segredo).digest();
  const b = crypto.createHash('sha256').update(recebido).digest();
  if (!recebido || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ message: 'Não autorizado.' });
  }

  if (!req.is('application/json')) {
    return res.status(415).json({ message: 'Content-Type deve ser application/json.' });
  }
  const tamanhoDeclarado = Number.parseInt(req.headers['content-length'] || '0', 10) || 0;
  const corpoTexto = JSON.stringify(req.body === undefined ? null : req.body);
  if (tamanhoDeclarado > MAX_PAYLOAD_BYTES || Buffer.byteLength(corpoTexto) > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ message: 'Payload excede o tamanho máximo.' });
  }

  const validacao = VALIDADORES_PAYLOAD[provider](req.body);
  if (!validacao.ok) {
    return res.status(400).json({ message: 'Payload inválido.', motivo: validacao.motivo });
  }

  req.webhook = { provider, corpoSha256: crypto.createHash('sha256').update(corpoTexto).digest('hex') };
  return next();
}

// Só metadados mínimos; nunca o corpo nem headers arbitrários.
function _headersParaLog(req) {
  const limpar = (v, max) => (v ? String(v).replace(/[^A-Za-z0-9 ._:;,/()+=-]/g, '').slice(0, max) : null);
  return {
    'content-type': limpar(req.headers['content-type'], 100),
    'user-agent': limpar(req.headers['user-agent'], 200),
    'x-request-id': limpar(req.headers['x-request-id'] || req.headers['x-vercel-id'], 100),
  };
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
router.post('/:provider', _webhookGuard, async (req, res) => {
  const { provider } = req.webhook;

  // Eventos já validados pelo contrato; duplicados no mesmo lote são descartados.
  const vistos = new Set();
  const eventosRecebidos = (Array.isArray(req.body) ? req.body : [req.body]).filter((evento) => {
    if (vistos.has(evento.codigoSolicitacao)) return false;
    vistos.add(evento.codigoSolicitacao);
    return true;
  });

  // Gravação ANTES de processar, só com um resumo (sem payload bruto).
  const logId = await webhookLogRepository.registrar({
    provider,
    payloadBruto: JSON.stringify({
      sha256: req.webhook.corpoSha256,
      qtd: eventosRecebidos.length,
      eventos: eventosRecebidos.map((e) => ({ codigoSolicitacao: e.codigoSolicitacao, situacao: e.situacao })),
    }),
    headersRecebidos: JSON.stringify(_headersParaLog(req)),
    ipOrigem: req.ip,
  });

  // Responde rápido — o provider tem sua própria política de retry/timeout
  // em cima deste endpoint; confirmamos recebimento e processamos depois
  // (mesmo padrão de waitUntil pós-resposta já usado em financeiroController).
  res.status(200).json({ recebido: true });

  waitUntil((async () => {
    try {
      const eventos = await bankingProviderRegistry.getProvider(provider).processarWebhook(null, eventosRecebidos);

      for (const evento of eventos) {
        await _processarEvento({ provider, logId, evento });
      }

      await webhookLogRepository.marcarProcessado(logId, { status: 'processado' });
    } catch (err) {
      await webhookLogRepository.marcarProcessado(logId, { status: 'erro', erroDetalhe: String(err?.message || 'erro').slice(0, 500) });
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

  const linhas = await postgres.query(
    `SELECT cb.id AS id_cobranca, cb.id_condominio, cb.id_receita, cb.provider AS cb_provider,
            cb.situacao, cb.id_externo,
            ib.*
       FROM "condominio-bh".tb_fin_cobranca_bancaria cb
       JOIN "condominio-bh".tb_fin_integracao_bancaria ib ON ib.id = cb.id_integracao_bancaria AND ib.ativo = true
      WHERE cb.provider = :provider AND cb.id_externo = :idExterno
      LIMIT 2`,
    { replacements: { provider, idExterno }, type: QueryTypes.SELECT }
  );

  // (provider, id_externo) não é UNIQUE no banco: mais de uma cobrança com o
  // mesmo id externo é ambíguo e nunca recebe baixa automática.
  if (linhas.length > 1) {
    console.warn(`[webhook-bancario] id_externo ambíguo (provider=${provider}); evento ignorado.`);
    await webhookLogRepository.marcarProcessado(logId, { status: 'ignorado', eventoTipo: evento.tipoEvento, idExterno, erroDetalhe: 'id_externo_ambiguo' });
    return;
  }
  const linha = linhas[0];
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
