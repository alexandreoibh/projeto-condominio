'use strict';

// TODO confirmar contra sandbox real — payload de webhook do Itaú ainda não
// validado empiricamente (diferente de interWebhookHandler.js, cujo shape
// foi confirmado em teste real contra o sandbox do Inter). Estrutura abaixo
// (array de eventos, campo de situação livre) é uma suposição de melhor
// esforço a partir do padrão comum de APIs de cobrança — deve ser revisada
// assim que houver acesso para cadastrar um webhook de teste e capturar o
// payload real (mesmo processo já feito para o Inter: cadastro do webhook +
// emissão de cobrança de teste + captura via webhook.site).
//
// Princípio defensivo mantido: o payload do webhook não deve ser tratado
// como fonte de verdade para dar baixa financeira — sempre reconsultar via
// consultarCobranca antes de aplicar qualquer mudança de estado (mesmo
// princípio documentado em interWebhookHandler.js).

const SITUACOES_PAGAS = new Set(['PAGO', 'LIQUIDADO', 'BAIXADO']);
const SITUACOES_CANCELADAS = new Set(['CANCELADO', 'EXPIRADO']);

/**
 * Normaliza um único evento do payload recebido no webhook.
 *
 * @param {object} evento Um item do payload recebido no corpo do webhook.
 * @returns {{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}}
 */
function _normalizarEvento(evento) {
  const situacaoItau = evento.situacao || evento.status;
  let situacaoNormalizada = 'desconhecida';
  if (SITUACOES_PAGAS.has(situacaoItau)) situacaoNormalizada = 'pago';
  else if (SITUACOES_CANCELADAS.has(situacaoItau)) situacaoNormalizada = 'cancelado';
  else if (situacaoItau === 'EM_ABERTO' || situacaoItau === 'A_RECEBER') situacaoNormalizada = 'em_aberto';
  else if (situacaoItau === 'ATRASADO' || situacaoItau === 'VENCIDO') situacaoNormalizada = 'atrasado';

  return {
    tipoEvento: `cobranca.${situacaoNormalizada}`,
    idExterno: evento.id_boleto || evento.codigoSolicitacao,
    situacao: situacaoNormalizada,
    dadosBrutos: evento,
  };
}

/**
 * @param {object} credencial (não usado hoje — mantido na assinatura para
 *   compatibilidade com o contrato de bankingProvider.interface.js, e para
 *   uma eventual necessidade futura de reconsultar a cobrança via API antes
 *   de confiar no payload).
 * @param {object|object[]} payload Corpo bruto recebido — aceitamos objeto
 *   único ou array por robustez, já que o formato real do Itaú ainda não
 *   foi confirmado.
 * @returns {Promise<Array<{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}>>}
 */
async function processarWebhook(credencial, payload) {
  const eventos = Array.isArray(payload) ? payload : [payload];
  return eventos
    .filter((evento) => evento && (evento.id_boleto || evento.codigoSolicitacao))
    .map((evento) => _normalizarEvento(evento));
}

module.exports = { processarWebhook };
