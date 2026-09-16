'use strict';

const { PATHS } = require('./itauConfig');
const { requisitar } = require('./itauHttpClient');
const { obterAccessToken } = require('./itauAuthClient');
const credentialCipher = require('../shared/credentialCipher');

async function _headersMtls(credencial) {
  const accessToken = await obterAccessToken(credencial);
  return {
    accessToken,
    certificadoBase64: credencial.certificado_cifrado ? credentialCipher.decrypt(credencial.certificado_cifrado) : undefined,
    chavePrivadaBase64: credencial.chave_privada_cifrada ? credentialCipher.decrypt(credencial.chave_privada_cifrada) : undefined,
  };
}

/**
 * POST /cash_management/v2/boletos — TODO confirmar contra sandbox real:
 * path, payload e shape de resposta ainda não validados empiricamente
 * (diferente de interCobrancaService.js, onde o payload foi confirmado
 * contra o sandbox real do Inter). Assinatura e shape de retorno seguem o
 * mesmo contrato de bankingProvider.interface.js para não exigir mudanças
 * em financeiroController.js.
 *
 * @param {object} credencial Linha de tb_fin_integracao_bancaria.
 * @param {object} dadosCobranca
 * @param {string} dadosCobranca.seuNumero Identificador próprio (usamos o id da receita).
 * @param {number} dadosCobranca.valorNominal
 * @param {string} dadosCobranca.dataVencimento Formato YYYY-MM-DD.
 * @param {object} dadosCobranca.pagador {cpfCnpj, tipoPessoa, nome, endereco, bairro, cidade, uf, cep}
 * @returns {Promise<{idExterno: string, payloadResposta: object}>}
 */
async function emitirCobranca(credencial, dadosCobranca) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.cobranca,
    method: 'POST',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body: dadosCobranca,
  });

  // TODO confirmar contra sandbox real — nome do campo de identificador
  // externo retornado pelo Itaú (aqui assumido "id_boleto" por convenção
  // comum de APIs cash_management, ainda não validado).
  return { idExterno: resposta.id_boleto || resposta.codigoSolicitacao, payloadResposta: resposta };
}

/**
 * GET /cash_management/v2/boletos/{idExterno} — TODO confirmar contra
 * sandbox real.
 *
 * @param {object} credencial
 * @param {string} idExterno
 * @returns {Promise<object>} Shape bruto do Itaú.
 */
async function consultarCobranca(credencial, idExterno) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: `${PATHS.cobranca}/${idExterno}`,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
  });
}

/**
 * POST /cash_management/v2/boletos/{idExterno}/baixa — TODO confirmar
 * contra sandbox real (path e nome da operação de cancelamento/baixa ainda
 * não validados; Itaú pode nomear como "baixa" em vez de "cancelar").
 *
 * @param {object} credencial
 * @param {string} idExterno
 * @param {string} motivo
 */
async function cancelarCobranca(credencial, idExterno, motivo) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: `${PATHS.cobranca}/${idExterno}/baixa`,
    method: 'POST',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body: { motivoBaixa: motivo },
  });
}

/**
 * GET /cash_management/v2/boletos/{idExterno}/pdf — TODO confirmar contra
 * sandbox real (path e shape de resposta; assumido `{ pdf: "<base64>" }`
 * por convenção comum, análogo ao Inter, ainda não validado).
 *
 * @param {object} credencial
 * @param {string} idExterno
 * @returns {Promise<Buffer>}
 */
async function consultarCobrancaPdf(credencial, idExterno) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: `${PATHS.cobranca}/${idExterno}/pdf`,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
  });

  return Buffer.from(resposta.pdf, 'base64');
}

module.exports = { emitirCobranca, consultarCobranca, cancelarCobranca, consultarCobrancaPdf };
