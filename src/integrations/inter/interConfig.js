'use strict';

// Paths confirmados contra clientes de referência de terceiros que consomem
// a API do Inter (ex: github.com/renatojdev/bancointer-python,
// github.com/samuelmoraesf/mcp-banco-inter) — o WebFetch não consegue
// renderizar o portal oficial (SPA client-side), então os paths foram
// cruzados entre duas implementações independentes antes de usar aqui.
const BASE_URLS = {
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
  production: 'https://cdpj.partners.bancointer.com.br',
};

const PATHS = {
  oauthToken: '/oauth/v2/token',
  cobranca: '/cobranca/v3/cobrancas',
  extrato: '/banking/v2/extrato',
  saldo: '/banking/v2/saldo',
};

/**
 * @param {string} ambiente 'sandbox' | 'production'
 * @returns {string}
 */
function obterBaseUrl(ambiente) {
  const baseUrl = BASE_URLS[ambiente];
  if (!baseUrl) {
    throw new Error(`Ambiente Inter desconhecido: "${ambiente}" (esperado "sandbox" ou "production").`);
  }
  return baseUrl;
}

module.exports = { obterBaseUrl, PATHS };
