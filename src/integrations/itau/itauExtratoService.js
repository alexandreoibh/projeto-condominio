'use strict';

const { PATHS } = require('./itauConfig');
const { requisitar } = require('./itauHttpClient');
const { obterAccessToken } = require('./itauAuthClient');
const credentialCipher = require('../shared/credentialCipher');

/**
 * GET /cash_management/v2/saldos — TODO confirmar contra sandbox real: path
 * e shape de resposta ainda não validados empiricamente (diferente de
 * interExtratoService.js, cujo path/shape foram cruzados contra clientes de
 * referência de terceiros). Shape de retorno assumido análogo ao Inter
 * ({ disponivel }) para manter o mesmo contrato normalizado.
 *
 * @param {object} credencial Linha de tb_fin_integracao_bancaria (campos *_cifrado ainda cifrados).
 * @param {string} [dataSaldo] Data no formato YYYY-MM-DD; se omitida, o Itaú usa a data corrente.
 * @returns {Promise<{disponivel: number, atualizadoEm: string}>}
 */
async function consultarSaldo(credencial, dataSaldo) {
  const accessToken = await obterAccessToken(credencial);
  const certificadoBase64 = credencial.certificado_cifrado ? credentialCipher.decrypt(credencial.certificado_cifrado) : undefined;
  const chavePrivadaBase64 = credencial.chave_privada_cifrada ? credentialCipher.decrypt(credencial.chave_privada_cifrada) : undefined;

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.saldo,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    query: dataSaldo ? { data_saldo: dataSaldo } : undefined,
  });

  // TODO confirmar contra sandbox real — nome do campo de saldo disponível
  // no payload de resposta do Itaú (assumido "disponivel" por convenção,
  // ainda não validado).
  return {
    disponivel: resposta.disponivel,
    atualizadoEm: new Date().toISOString(),
  };
}

/**
 * GET /cash_management/v2/extratos?data_inicio=&data_fim= — TODO confirmar
 * contra sandbox real: path, nome dos query params e shape da lista de
 * transações ainda não validados.
 *
 * @param {object} credencial
 * @param {string} dataInicio Formato YYYY-MM-DD.
 * @param {string} dataFim Formato YYYY-MM-DD.
 * @returns {Promise<object[]>} Lista de transações no shape bruto do Itaú.
 */
async function consultarExtrato(credencial, dataInicio, dataFim) {
  const accessToken = await obterAccessToken(credencial);
  const certificadoBase64 = credencial.certificado_cifrado ? credentialCipher.decrypt(credencial.certificado_cifrado) : undefined;
  const chavePrivadaBase64 = credencial.chave_privada_cifrada ? credentialCipher.decrypt(credencial.chave_privada_cifrada) : undefined;

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.extrato,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    query: { data_inicio: dataInicio, data_fim: dataFim },
  });

  return resposta.transacoes || [];
}

module.exports = { consultarSaldo, consultarExtrato };
