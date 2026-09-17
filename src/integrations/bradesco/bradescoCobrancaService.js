'use strict';

const { PATHS } = require('./bradescoConfig');
const { requisitar } = require('./bradescoHttpClient');
const { obterAccessToken } = require('./bradescoAuthClient');
const credentialCipher = require('../shared/credentialCipher');

// TODO (ver plano — "Ponto aberto"): consultarCobranca/cancelarCobranca
// exigem cpfCnpj/produto/negociacao do BENEFICIÁRIO (o condomínio), não do
// boleto individual — confirmado nos exemplos reais da collection
// ("Cobrança - Cliente"). Esses dados são configuração fixa da conta de
// cobrança do condomínio junto ao Bradesco, e tb_fin_integracao_bancaria
// não tem colunas para eles hoje. Até essa lacuna de schema ser resolvida
// (nova migration ou coluna de config genérica), estas funções leem de
// credencial.conta_corrente (mapeado para "negociacao") e lançam erro claro
// se os demais campos não estiverem disponíveis — não inventar valores.
function _dadosBeneficiario(credencial) {
  if (!credencial.conta_corrente) {
    throw new Error(
      'Configuração de cobrança Bradesco incompleta: conta_corrente (negociacao) não cadastrado para esta integração.'
    );
  }
  // TODO: cpfCnpj/produto ainda não têm coluna dedicada — ver "Ponto aberto"
  // no plano de implementação. Sem eles, consultarCobranca/cancelarCobranca
  // não podem ser chamados de fato; emitirCobranca já falha antes disso.
  throw new Error(
    'Configuração de cobrança Bradesco incompleta: cpfCnpj/produto do beneficiário ainda não têm coluna dedicada em tb_fin_integracao_bancaria — ver "Ponto aberto" no plano.'
  );
}

async function _headersMtls(credencial) {
  const accessToken = await obterAccessToken(credencial);
  return {
    accessToken,
    certificadoBase64: credentialCipher.decrypt(credencial.certificado_cifrado),
    chavePrivadaBase64: credentialCipher.decrypt(credencial.chave_privada_cifrada),
  };
}

/**
 * Converte uma data ISO (YYYY-MM-DD) para o formato DD.MM.AAAA exigido pelo
 * registro de boleto do Bradesco — confirmado no exemplo real da collection
 * ("dtVencimentoTitulo": "27.08.2025").
 *
 * @param {string} dataIso
 */
function _paraDataBradesco(dataIso) {
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}.${mes}.${ano}`;
}

/**
 * POST /boleto/cobranca-registro/v1/cobranca — path e payload confirmados
 * via collection Postman do sandbox ("Cobrança - Registro de boleto" ->
 * "Boleto de Cobrança Convencional - Sucesso"), não testado empiricamente
 * (credencial ainda não habilitada). O shape de resposta de SUCESSO não
 * está documentado na collection (só o de erro) — normalizamos de forma
 * defensiva, aceitando o campo de identificador que vier.
 *
 * @param {object} credencial Linha de tb_fin_integracao_bancaria.
 * @param {object} dadosCobranca
 * @param {string} dadosCobranca.seuNumero Identificador próprio (usamos o id da receita).
 * @param {number} dadosCobranca.valorNominal
 * @param {string} dadosCobranca.dataVencimento Formato YYYY-MM-DD.
 * @param {object} dadosCobranca.pagador {cpfCnpj, nome, endereco, bairro, cidade, uf, cep}
 * @returns {Promise<{idExterno: string, payloadResposta: object}>}
 */
async function emitirCobranca(credencial, dadosCobranca) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);

  const hoje = _paraDataBradesco(new Date().toISOString().slice(0, 10));
  const body = {
    // TODO: nuCPFCNPJ/filialCPFCNPJ/ctrlCPFCNPJ/idProduto/nuNegociacao são
    // dados do beneficiário (condomínio), não do boleto — ver
    // "Ponto aberto" no plano. Sem coluna dedicada, não é possível montar
    // este payload de forma confiável ainda.
    dtEmissaoTitulo: hoje,
    dtVencimentoTitulo: _paraDataBradesco(dadosCobranca.dataVencimento),
    vlNominalTitulo: Number(dadosCobranca.valorNominal).toFixed(2),
    nomePagador: dadosCobranca.pagador?.nome,
    nuCpfcnpjPagador: dadosCobranca.pagador?.cpfCnpj,
    logradouroPagador: dadosCobranca.pagador?.endereco,
    bairroPagador: dadosCobranca.pagador?.bairro,
    municipioPagador: dadosCobranca.pagador?.cidade,
    ufPagador: dadosCobranca.pagador?.uf,
    cepPagador: dadosCobranca.pagador?.cep,
  };

  const resposta = await requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.boletoRegistrar,
    method: 'POST',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body,
  });

  // TODO confirmar via chamada real — nome do campo de identificador
  // (nosso número) retornado no sucesso do registro; a collection não tem
  // exemplo de resposta 200 para este endpoint.
  return { idExterno: resposta?.nossoNumero || resposta?.negociacao, payloadResposta: resposta };
}

/**
 * POST /boleto/cobranca-consulta/v1/consultar — path e payload confirmados
 * via collection ("Cobrança - Consulta de boleto especifico e emissão de 2ª
 * via" -> "Consulta dados de Título Específico - Sucesso").
 *
 * @param {object} credencial
 * @param {string} idExterno nossoNumero do título.
 * @returns {Promise<object>} Shape bruto do Bradesco.
 */
async function consultarCobranca(credencial, idExterno) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);
  const { cpfCnpj, produto, negociacao } = _dadosBeneficiario(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.boletoConsultar,
    method: 'POST',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body: { cpfCnpj, produto, negociacao, nossoNumero: idExterno, sequencia: 0, status: 0 },
  });
}

/**
 * POST /boleto/cobranca-baixa/v1/baixar — path e payload confirmados via
 * collection ("Cobrança - Solicitação de baixa de boleto" -> "Solicitação
 * Baixa de Título - Sucesso"). codigoBaixa: 57 é o valor usado em todos os
 * exemplos de sucesso da collection (código de baixa "a pedido do
 * beneficiário", assumido — não há legenda de códigos na collection).
 *
 * @param {object} credencial
 * @param {string} idExterno nossoNumero do título.
 * @param {string} _motivo Não utilizado pelo Bradesco (sem campo livre de motivo na collection).
 */
async function cancelarCobranca(credencial, idExterno, _motivo) {
  const { accessToken, certificadoBase64, chavePrivadaBase64 } = await _headersMtls(credencial);
  const { cpfCnpj, produto, negociacao } = _dadosBeneficiario(credencial);

  return requisitar({
    ambiente: credencial.ambiente,
    path: PATHS.boletoBaixar,
    method: 'POST',
    accessToken,
    certificadoBase64,
    chavePrivadaBase64,
    body: { cpfCnpj, produto, negociacao, nossoNumero: idExterno, sequencia: 0, codigoBaixa: 57 },
  });
}

/**
 * Não há endpoint de PDF do boleto nas collections disponíveis do sandbox
 * Bradesco — diferente do Inter/Itaú. Não inventar um path; investigar no
 * portal (pode estar em outro produto, ou o PDF pode precisar ser montado
 * localmente a partir da linha digitável/código de barras retornados no
 * registro).
 */
async function consultarCobrancaPdf() {
  throw new Error('consultarCobrancaPdf não implementado para Bradesco — endpoint não encontrado nas collections disponíveis.');
}

module.exports = { emitirCobranca, consultarCobranca, cancelarCobranca, consultarCobrancaPdf };
