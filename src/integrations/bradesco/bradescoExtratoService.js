'use strict';

const { PATHS } = require('./bradescoConfig');
const { requisitar } = require('./bradescoHttpClient');
const { obterAccessToken } = require('./bradescoAuthClient');
const credentialCipher = require('../shared/credentialCipher');

/**
 * Converte uma data ISO (YYYY-MM-DD) para o formato DDMMAAAA (sem
 * separador) exigido pelos endpoints de extrato/saldo do Bradesco —
 * confirmado no exemplo real da collection ("dataInicio=06112024").
 *
 * @param {string} dataIso
 */
function _paraDataBradesco(dataIso) {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}${mes}${ano}`;
}

/**
 * Converte "DD/MM/AAAA" (formato do extrato Bradesco) para ISO YYYY-MM-DD.
 *
 * @param {string} dataBr
 */
function _paraIso(dataBr) {
  const [dia, mes, ano] = dataBr.split('/');
  return `${ano}-${mes}-${dia}`;
}

async function _headers(credencial) {
  const accessToken = await obterAccessToken(credencial);
  return {
    accessToken,
    certificadoBase64: credentialCipher.decrypt(credencial.certificado_cifrado),
    chavePrivadaBase64: credentialCipher.decrypt(credencial.chave_privada_cifrada),
  };
}

/**
 * GET /v1/fornecimento-saldos-contas/saldos?agencia=&conta= — path
 * confirmado via collection Postman do sandbox ("Saldo e extrato | cliente"
 * -> "Consulta de Saldos de Contas"). Shape de resposta de sucesso não
 * confirmado nesta sessão (trecho da collection não capturado) — acesso
 * defensivo ao campo de saldo.
 *
 * @param {object} credencial Linha de tb_fin_integracao_bancaria (campos *_cifrado ainda cifrados).
 * @returns {Promise<{disponivel: number, atualizadoEm: string}>}
 */
async function consultarSaldo(credencial) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headers(credencial);

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.saldo,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    query: { agencia: credencial.agencia, conta: credencial.conta_corrente },
  });

  // TODO confirmar contra chamada real — nome exato do campo de saldo
  // disponível no payload de resposta do Bradesco.
  return {
    disponivel: resposta?.saldoDisponivel ?? resposta?.disponivel,
    atualizadoEm: new Date().toISOString(),
  };
}

/**
 * GET /v1/fornecimento-extratos-contas/extratos?agencia=&conta=&tipo=cc&dataInicio=&dataFim=
 * — path, query params e shape de resposta confirmados via collection
 * Postman do sandbox (exemplo real de sucesso 200 e de erro 400 gravados).
 * Datas no formato DDMMAAAA sem separador (diferente do resto do projeto,
 * que usa YYYY-MM-DD — a conversão é feita aqui). Limite confirmado por
 * erro real da collection: intervalo máximo de 1 ano entre dataInicio e
 * dataFim ("PERIODO NAO PERMITIDO" / "Intervalo maximo de pesquisa
 * permitido: 1 ano").
 *
 * A resposta tem 3 seções (extratoUltimosLancamentos,
 * extratoLancamentosFuturos, extratoPorPeriodo) — usamos
 * extratoPorPeriodo.lstLancamentoMensal, a única lista plana com todos os
 * lançamentos do período pedido.
 *
 * @param {object} credencial
 * @param {string} dataInicio Formato YYYY-MM-DD.
 * @param {string} dataFim Formato YYYY-MM-DD.
 * @returns {Promise<object[]>} Lista de transações normalizada, mesmo shape usado por Inter/Itaú.
 */
async function consultarExtrato(credencial, dataInicio, dataFim) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headers(credencial);

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.extrato,
    method: 'GET',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    query: {
      agencia: credencial.agencia,
      conta: credencial.conta_corrente,
      tipo: 'cc',
      dataInicio: _paraDataBradesco(dataInicio),
      dataFim: _paraDataBradesco(dataFim),
    },
  });

  const lancamentos = resposta?.extratoPorPeriodo?.lstLancamentoMensal || [];

  return lancamentos.map((item) => ({
    dataEntrada: _paraIso(item.dataLancamento),
    // Confirmado via collection: sinalLancamento é "+" (crédito) ou "-"
    // (débito), separado do valor — normalizado para tipoOperacao "C"/"D"
    // como já usado por interExtratoService/itauExtratoService.
    tipoOperacao: item.sinalLancamento === '-' ? 'D' : 'C',
    // valorLancamento vem como string com vírgula decimal (ex: "700,00") —
    // convertido para string numérica com ponto, mesmo formato do Inter/Itaú.
    valor: String(item.valorLancamento || '0').replace(/\./g, '').replace(',', '.'),
    titulo: item.descritivoLancamentoAbreviado || '',
    descricao: item.descritivoLancamentoCompleto || item.segundaLinhalLancamento || '',
  }));
}

module.exports = { consultarSaldo, consultarExtrato };
