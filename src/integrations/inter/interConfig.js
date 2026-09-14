'use strict';

// Endpoints e base URL a confirmar contra a documentação oficial do Inter
// Developers (Swagger) antes de implementar as Fases 4/5/6 — ver plano,
// seção "Riscos". Valores abaixo são o melhor palpite estrutural atual.
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
