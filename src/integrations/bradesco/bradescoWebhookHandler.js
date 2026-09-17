'use strict';

// A collection do sandbox Bradesco tem um endpoint de CADASTRO de webhook
// (POST /boleto/cobranca-webhook/v1/cadastrar), mas nenhum exemplo do
// payload que o Bradesco de fato ENVIA quando um boleto muda de situação —
// diferente do Inter (confirmado via teste real contra webhook.site) e do
// Itaú (ao menos com suposição estruturada por convenção comum). O shape
// abaixo é uma suposição defensiva por nomes de campo comuns entre os
// outros dois providers — PRIORIDADE ALTA para confirmar o payload real
// assim que a credencial habilitar (cadastrar um webhook de teste + emitir
// um boleto de teste + capturar via webhook.site, mesmo processo já feito
// para o Inter).
//
// Princípio defensivo mantido (igual Inter/Itaú): o payload do webhook não
// deve ser tratado como fonte de verdade para dar baixa financeira — sempre
// reconsultar via consultarCobranca antes de aplicar qualquer mudança de
// estado.

const SITUACOES_PAGAS = new Set(['PAGO', 'LIQUIDADO', 'BAIXADO']);
const SITUACOES_CANCELADAS = new Set(['CANCELADO', 'BAIXA', 'EXPIRADO']);

/**
 * Normaliza um único evento do payload recebido no webhook.
 *
 * @param {object} evento Um item do payload recebido no corpo do webhook.
 * @returns {{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}}
 */
function _normalizarEvento(evento) {
  const situacaoBradesco = evento.situacao || evento.status;
  let situacaoNormalizada = 'desconhecida';
  if (SITUACOES_PAGAS.has(situacaoBradesco)) situacaoNormalizada = 'pago';
  else if (SITUACOES_CANCELADAS.has(situacaoBradesco)) situacaoNormalizada = 'cancelado';
  else if (situacaoBradesco === 'EM_ABERTO' || situacaoBradesco === 'PENDENTE') situacaoNormalizada = 'em_aberto';
  else if (situacaoBradesco === 'ATRASADO' || situacaoBradesco === 'VENCIDO') situacaoNormalizada = 'atrasado';

  return {
    tipoEvento: `cobranca.${situacaoNormalizada}`,
    idExterno: evento.nossoNumero,
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
 *   único ou array por robustez, já que o formato real do Bradesco ainda
 *   não foi confirmado.
 * @returns {Promise<Array<{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}>>}
 */
async function processarWebhook(credencial, payload) {
  const eventos = Array.isArray(payload) ? payload : [payload];
  return eventos
    .filter((evento) => evento && evento.nossoNumero)
    .map((evento) => _normalizarEvento(evento));
}

module.exports = { processarWebhook };
