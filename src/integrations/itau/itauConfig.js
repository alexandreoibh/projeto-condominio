'use strict';

// TODO confirmar contra sandbox real — paths e hosts abaixo são
// melhor-esforço a partir da documentação pública do Itaú Developers
// (devportal.itau.com.br), NÃO confirmados empiricamente como os do Inter
// (que citam clientes de referência de terceiros testados). Ajustar assim
// que houver client_id/client_secret de sandbox para validar via
// testarConexao().
const BASE_URLS = {
  sandbox: 'https://sandbox.devportal.itau.com.br',
  production: 'https://secure.api.itau',
};

const PATHS = {
  oauthToken: '/api/oauth/token',
  cobranca: '/cash_management/v2/boletos',
  pixCobranca: '/pix/v2/cob',
  extrato: '/cash_management/v2/extratos',
  saldo: '/cash_management/v2/saldos',
};

/**
 * @param {string} ambiente 'sandbox' | 'production'
 * @returns {string}
 */
function obterBaseUrl(ambiente) {
  const baseUrl = BASE_URLS[ambiente];
  if (!baseUrl) {
    throw new Error(`Ambiente Itaú desconhecido: "${ambiente}" (esperado "sandbox" ou "production").`);
  }
  return baseUrl;
}

module.exports = { obterBaseUrl, PATHS };
