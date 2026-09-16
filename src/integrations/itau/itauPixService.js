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
 * PUT /pix/v2/cob/{txid} — TODO confirmar contra sandbox real. Segue o
 * padrão do BACEN (DICT/Pix) de cobrança com txid definido pelo cliente,
 * como no Inter, mas payload/shape ainda não validados contra o Itaú.
 * Produto adicional (não faz parte do contrato bankingProvider.interface.js
 * hoje, que só exige emitirCobranca/consultarCobranca/cancelarCobranca/
 * consultarCobrancaPdf/consultarExtrato/consultarSaldo/processarWebhook/
 * testarConexao) — exposto à parte para uso futuro quando o PIX for
 * integrado a um call-site de negócio.
 *
 * @param {object} credencial
 * @param {string} txid Identificador da cobrança Pix (definido por nós).
 * @param {object} dadosCobranca {valor: {original}, devedor: {cpf|cnpj, nome}, chave, calendario: {expiracao}}
 * @returns {Promise<object>} Shape bruto do Itaú.
 */
async function emitirCobrancaPix(credencial, txid, dadosCobranca) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: `${PATHS.pixCobranca}/${txid}`,
    method: 'PUT',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body: dadosCobranca,
  });
}

/**
 * GET /pix/v2/cob/{txid} — TODO confirmar contra sandbox real.
 *
 * @param {object} credencial
 * @param {string} txid
 * @returns {Promise<object>} Shape bruto do Itaú.
 */
async function consultarCobrancaPix(credencial, txid) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: `${PATHS.pixCobranca}/${txid}`,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
  });
}

module.exports = { emitirCobrancaPix, consultarCobrancaPix };
