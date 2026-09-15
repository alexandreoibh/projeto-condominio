'use strict';

const express = require('express');
const router = express.Router();
const { QueryTypes } = require('sequelize');
const { waitUntil } = require('@vercel/functions');

const postgres = require('../database/postgres');
const bankingProviderRegistry = require('../integrations/bankingProviderRegistry');
const webhookLogRepository = require('../integrations/shared/webhookLogRepository');
const cobrancaBancariaRepository = require('../integrations/shared/cobrancaBancariaRepository');

/**
 * Rota pública (sem middleware `auth`) — é chamada pelo banco, não por um
 * usuário logado. Segurança observada empiricamente contra o Inter: não há
 * HMAC/assinatura nem Bearer/Basic Auth no payload recebido (testado em
 * sandbox) — a única barreira é a própria imprevisibilidade da URL
 * cadastrada. Ver interWebhookHandler.js para o detalhe do payload real.
 */
router.post('/:provider', async (req, res) => {
  const { provider } = req.params;

  // Gravação ANTES de processar — auditoria garantida mesmo que o
  // processamento abaixo falhe ou a invocação serverless seja cortada.
  const logId = await webhookLogRepository.registrar({
    provider,
    payloadBruto: JSON.stringify(req.body),
    headersRecebidos: JSON.stringify(req.headers),
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
  const { tipoEvento, idExterno, situacao } = evento;

  const jaProcessado = await webhookLogRepository.jaProcessado({ provider, idExterno, eventoTipo: tipoEvento });
  if (jaProcessado) {
    await webhookLogRepository.marcarProcessado(logId, { status: 'ignorado', eventoTipo: tipoEvento, idExterno });
    return;
  }

  const [cobranca] = await postgres.query(
    `SELECT * FROM "condominio-bh".tb_fin_cobranca_bancaria
      WHERE provider = :provider AND id_externo = :idExterno`,
    { replacements: { provider, idExterno }, type: QueryTypes.SELECT }
  );

  if (!cobranca) {
    // Cobrança emitida fora deste sistema (ex: manual no Internet Banking)
    // ou ainda não persistida — nada a atualizar aqui além do log.
    await webhookLogRepository.marcarProcessado(logId, { status: 'ignorado', eventoTipo: tipoEvento, idExterno });
    return;
  }

  await webhookLogRepository.marcarProcessado(logId, {
    status: 'processado',
    eventoTipo: tipoEvento,
    idExterno,
    idCondominio: cobranca.id_condominio,
  });

  await cobrancaBancariaRepository.aplicarSituacao(cobranca, situacao);
}

module.exports = router;
