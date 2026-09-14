'use strict';

// Payload confirmado empiricamente em teste real contra o sandbox do Inter
// (cadastro via PUT /cobranca/v3/cobrancas/webhook + emissão de cobrança de
// teste + captura via webhook.site), não apenas inferido de terceiros:
//
//   [
//     {
//       "codigoSolicitacao": "36ae8e6f-...",
//       "seuNumero": "TESTE001",
//       "situacao": "A_RECEBER",
//       "dataHoraSituacao": "2026-09-14T17:37:49.462Z",
//       "nossoNumero": "3486492750",
//       "codigoBarras": "...",
//       "linhaDigitavel": "...",
//       "txid": "...",
//       "pixCopiaECola": "..."
//     }
//   ]
//
// Confirmado nesse teste:
// - O corpo é sempre um ARRAY (o Inter pode enviar vários eventos numa chamada).
// - O Inter dispara o webhook em QUALQUER mudança de situação (inclusive na
//   emissão, situação "A_RECEBER"), não só quando a cobrança é paga.
// - Não há HMAC/assinatura no body nem Bearer/Basic Auth nos headers — os
//   headers observados foram x-conta-corrente, x-chave-idempotencia,
//   content-type, user-agent, host. x-chave-idempotencia é único por
//   disparo e serve como chave de deduplicação adicional àquela já feita
//   por (provider, id_externo, evento_tipo) em webhookLogRepository.
// - O payload não deve ser tratado como fonte de verdade para dar baixa
//   financeira: os campos batem com o retorno de
//   GET /cobranca/v3/cobrancas/{codigoSolicitacao}, mas nada garante que o
//   Inter não adicione/altere campos no futuro — por isso mantemos o
//   princípio defensivo de reconsultar antes de aplicar qualquer mudança
//   de estado (ver Fase 4/consultarCobranca, quando disponível).

const SITUACOES_PAGAS = new Set(['RECEBIDO', 'PAGO', 'MARCADO_RECEBIDO']);
const SITUACOES_CANCELADAS = new Set(['CANCELADO', 'EXPIRADO']);

/**
 * Normaliza um único evento do array recebido no webhook.
 *
 * @param {object} credencial (não usado hoje — mantido na assinatura para
 *   compatibilidade com o contrato de bankingProvider.interface.js, e para
 *   uma eventual necessidade futura de reconsultar a cobrança via API antes
 *   de confiar no payload).
 * @param {object} evento Um item do array recebido no corpo do webhook.
 * @returns {{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}}
 */
function _normalizarEvento(evento) {
  const situacaoInter = evento.situacao;
  let situacaoNormalizada = 'desconhecida';
  if (SITUACOES_PAGAS.has(situacaoInter)) situacaoNormalizada = 'pago';
  else if (SITUACOES_CANCELADAS.has(situacaoInter)) situacaoNormalizada = 'cancelado';
  else if (situacaoInter === 'A_RECEBER') situacaoNormalizada = 'em_aberto';
  else if (situacaoInter === 'ATRASADO') situacaoNormalizada = 'atrasado';

  return {
    tipoEvento: `cobranca.${situacaoNormalizada}`,
    idExterno: evento.codigoSolicitacao,
    situacao: situacaoNormalizada,
    dadosBrutos: evento,
  };
}

/**
 * @param {object} credencial
 * @param {object|object[]} payload Corpo bruto recebido — o Inter envia um
 *   array, mas aceitamos objeto único também por robustez.
 * @returns {Promise<Array<{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}>>}
 */
async function processarWebhook(credencial, payload) {
  const eventos = Array.isArray(payload) ? payload : [payload];
  return eventos
    .filter((evento) => evento && evento.codigoSolicitacao)
    .map((evento) => _normalizarEvento(evento));
}

module.exports = { processarWebhook };
