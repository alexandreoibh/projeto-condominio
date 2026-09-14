'use strict';

// Mecanismo real de validação de webhook (assinatura/segredo/mTLS reverso)
// e shape exato do payload de evento dependem de confirmação contra a doc
// oficial do Inter — ver plano, seção "Riscos", itens 1 e 4.
// Implementação real entra na Fase 5 (Webhook).

/* eslint-disable no-unused-vars */
/**
 * @param {object} credencial
 * @param {object} payload
 * @returns {Promise<{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}>}
 */
async function processarWebhook(credencial, payload) {
  throw new Error('interWebhookHandler.processarWebhook ainda não implementado (Fase 5).');
}
/* eslint-enable no-unused-vars */

module.exports = { processarWebhook };
