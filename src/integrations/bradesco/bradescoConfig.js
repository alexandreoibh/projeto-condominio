'use strict';

// Host de sandbox e paths confirmados diretamente contra as collections
// Postman reais do sandbox Bradesco ("Cobrança - Cliente" e "Saldo e
// extrato | cliente"), incluindo exemplos de request/response gravados —
// não é melhor-esforço como em itau/itauConfig.js. Nenhuma chamada real foi
// executada nesta sessão (credencial ainda aguardando habilitação), então
// os comentários nos demais arquivos usam "confirmado via collection", não
// "testado empiricamente" (reservado para chamadas reais, como no Inter).
const BASE_URLS = {
  sandbox: 'https://openapisandbox.prebanco.com.br',
  production: 'https://openapi.bradesco.com.br', // TODO confirmar host de produção no portal Bradesco Developers
};

const PATHS = {
  oauthToken: '/auth/server-mtls/v2/token',
  boletoRegistrar: '/boleto/cobranca-registro/v1/cobranca',
  boletoAlterar: '/boleto/cobranca-altera/v1/alterar',
  boletoConsultar: '/boleto/cobranca-consulta/v1/consultar',
  boletoBaixar: '/boleto/cobranca-baixa/v1/baixar',
  boletoWebhookCadastrar: '/boleto/cobranca-webhook/v1/cadastrar',
  extrato: '/v1/fornecimento-extratos-contas/extratos',
  saldo: '/v1/fornecimento-saldos-contas/saldos',
};

/**
 * @param {string} ambiente 'sandbox' | 'production'
 * @returns {string}
 */
function obterBaseUrl(ambiente) {
  const baseUrl = BASE_URLS[ambiente];
  if (!baseUrl) {
    throw new Error(`Ambiente Bradesco desconhecido: "${ambiente}" (esperado "sandbox" ou "production").`);
  }
  return baseUrl;
}

module.exports = { obterBaseUrl, PATHS };
