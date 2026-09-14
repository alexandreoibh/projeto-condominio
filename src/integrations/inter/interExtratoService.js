'use strict';

const { PATHS } = require('./interConfig');
const { requisitar } = require('./interHttpClient');
const { obterAccessToken } = require('./interAuthClient');
const credentialCipher = require('../shared/credentialCipher');

/**
 * GET /banking/v2/saldo — path e shape de resposta confirmados contra dois
 * clientes de referência independentes que consomem a API do Inter
 * (github.com/renatojdev/bancointer-python, github.com/samuelmoraesf/mcp-banco-inter),
 * já que o portal oficial é uma SPA client-side que não é possível renderizar
 * via fetch simples. Resposta: { disponivel, bloqueadoCheque, bloqueadoJudicialmente,
 * bloqueadoAdministrativo, limite } — todos number, exceto quando ausentes.
 *
 * @param {object} credencial Linha de tb_fin_integracao_bancaria (campos *_cifrado ainda cifrados).
 * @param {string} [dataSaldo] Data no formato YYYY-MM-DD; se omitida, o Inter usa a data corrente.
 * @returns {Promise<{disponivel: number, atualizadoEm: string}>}
 */
async function consultarSaldo(credencial, dataSaldo) {
  const accessToken = await obterAccessToken(credencial);
  const certificadoBase64 = credentialCipher.decrypt(credencial.certificado_cifrado);
  const chavePrivadaBase64 = credentialCipher.decrypt(credencial.chave_privada_cifrada);

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.saldo,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    query: dataSaldo ? { dataSaldo } : undefined,
  });

  return {
    disponivel: resposta.disponivel,
    atualizadoEm: new Date().toISOString(),
  };
}

/**
 * GET /banking/v2/extrato?dataInicio=&dataFim= — path/params confirmados
 * contra os mesmos clientes de referência citados acima.
 *
 * @param {object} credencial
 * @param {string} dataInicio Formato YYYY-MM-DD.
 * @param {string} dataFim Formato YYYY-MM-DD.
 * @returns {Promise<object[]>} Lista de transações no shape bruto do Inter
 *   (dataLancamento, tipoLancamento, tipoOperacao, valor, titulo, descricao).
 */
async function consultarExtrato(credencial, dataInicio, dataFim) {
  const accessToken = await obterAccessToken(credencial);
  const certificadoBase64 = credentialCipher.decrypt(credencial.certificado_cifrado);
  const chavePrivadaBase64 = credentialCipher.decrypt(credencial.chave_privada_cifrada);

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.extrato,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    query: { dataInicio, dataFim },
  });

  return resposta.transacoes || [];
}

module.exports = { consultarSaldo, consultarExtrato };
