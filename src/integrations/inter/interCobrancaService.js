'use strict';

const { PATHS } = require('./interConfig');
const { requisitar } = require('./interHttpClient');
const { obterAccessToken } = require('./interAuthClient');
const credentialCipher = require('../shared/credentialCipher');

async function _headersMtls(credencial) {
  const accessToken = await obterAccessToken(credencial);
  return {
    accessToken,
    certificadoBase64: credentialCipher.decrypt(credencial.certificado_cifrado),
    chavePrivadaBase64: credentialCipher.decrypt(credencial.chave_privada_cifrada),
  };
}

/**
 * POST /cobranca/v3/cobrancas — payload confirmado empiricamente contra o
 * sandbox real do Inter (não apenas inferido de terceiros). Valor mínimo
 * aceito pelo Inter é R$ 2,50 (violação retornada em teste real quando
 * enviado R$ 1,00: "O valor deve ser maior ou igual a 2.5").
 *
 * @param {object} credencial Linha de tb_fin_integracao_bancaria.
 * @param {object} dadosCobranca
 * @param {string} dadosCobranca.seuNumero Identificador próprio (usamos o id da receita).
 * @param {number} dadosCobranca.valorNominal
 * @param {string} dadosCobranca.dataVencimento Formato YYYY-MM-DD.
 * @param {object} dadosCobranca.pagador {cpfCnpj, tipoPessoa, nome, endereco, bairro, cidade, uf, cep}
 * @param {number} [dadosCobranca.numDiasAgenda]
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

  return { idExterno: resposta.codigoSolicitacao, payloadResposta: resposta };
}

/**
 * GET /cobranca/v3/cobrancas/{codigoSolicitacao} — resposta confirmada em
 * teste real: { cobranca: {...}, boleto: {nossoNumero, codigoBarras,
 * linhaDigitavel}, pix: {txid, pixCopiaECola} }. O Inter emite boleto E pix
 * juntos por padrão, mesmo sem solicitar pix explicitamente.
 *
 * @param {object} credencial
 * @param {string} idExterno codigoSolicitacao.
 * @returns {Promise<object>} Shape bruto do Inter (cobranca/boleto/pix).
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
 * POST /cobranca/v3/cobrancas/{codigoSolicitacao}/cancelar
 *
 * @param {object} credencial
 * @param {string} idExterno codigoSolicitacao.
 * @param {string} motivo
 */
async function cancelarCobranca(credencial, idExterno, motivo) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: `${PATHS.cobranca}/${idExterno}/cancelar`,
    method: 'POST',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body: { motivoCancelamento: motivo },
  });
}

/**
 * GET /cobranca/v3/cobrancas/{codigoSolicitacao}/pdf — resposta do Inter é
 * `{ pdf: "<base64>" }` (confirmado na collection Postman oficial do Inter
 * Developers). Retorna o Buffer já decodificado — quem chama decide como
 * servir (ex: endpoint HTTP dedicado com Content-Type: application/pdf).
 *
 * @param {object} credencial
 * @param {string} idExterno codigoSolicitacao.
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
