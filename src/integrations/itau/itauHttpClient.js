'use strict';

const https = require('https');
const fetch = require('node-fetch');
const { obterBaseUrl } = require('./itauConfig');
const BankingHttpError = require('../shared/bankingHttpError');

/**
 * Monta o agente HTTPS com o certificado mTLS, quando fornecido. Diferente
 * do Inter (onde mTLS é sempre obrigatório), o sandbox do Itaú
 * TODO confirmar contra sandbox real — pode não exigir certificado cliente
 * para todos os produtos, então este client aceita operar sem mTLS.
 *
 * @param {string} [certificadoBase64]
 * @param {string} [chavePrivadaBase64]
 * @returns {https.Agent|undefined}
 */
function _criarAgenteMtls(certificadoBase64, chavePrivadaBase64) {
  if (!certificadoBase64 || !chavePrivadaBase64) return undefined;
  return new https.Agent({
    cert: Buffer.from(certificadoBase64, 'base64'),
    key: Buffer.from(chavePrivadaBase64, 'base64'),
  });
}

// RESTRIÇÃO DE SEGURANÇA DELIBERADA (mesma exigência de produto aplicada ao
// Inter — ver interHttpClient.js): o e-Morador só pode RECEBER dinheiro,
// nunca mover dinheiro para fora da conta do condomínio. Esta allowlist
// bloqueia fisicamente qualquer chamada a endpoints de pagamento/transferência
// de saída do Itaú, mesmo que alguém tente implementar isso no futuro por
// engano — segunda camada de defesa, complementar à omissão de qualquer
// escopo de pagamento em itauAuthClient.js.
// TODO confirmar contra sandbox real — prefixos abaixo são melhor-esforço.
const PREFIXOS_PATH_PERMITIDOS = [
  '/cash_management/v2/boletos',  // emitir/consultar/cancelar boleto (receber)
  '/cash_management/v2/extratos', // consulta, somente leitura
  '/cash_management/v2/saldos',   // consulta, somente leitura
  '/pix/v2/cob',                  // Pix cobrança imediata (receber)
  '/pix/v2/cobv',                 // Pix cobrança com vencimento (receber)
  '/pix/v2/webhook',              // configurar webhook Pix
];

function _validarPathPermitido(path) {
  const caminho = path.split('?')[0];
  const permitido = PREFIXOS_PATH_PERMITIDOS.some((prefixo) => caminho.startsWith(prefixo));
  if (!permitido) {
    throw new Error(
      `Chamada bloqueada por política de segurança: "${caminho}" não está na allowlist de endpoints permitidos ` +
      `(o e-Morador não pode realizar pagamentos/transferências de saída via API do Itaú).`
    );
  }
}

/**
 * Requisição autenticada (Bearer + mTLS opcional) a um endpoint de negócio
 * do Itaú. Não faz retry aqui — retry é decisão de negócio de quem chama.
 *
 * @param {object} params
 * @param {string} params.ambiente 'sandbox' | 'production'
 * @param {string} params.path
 * @param {string} params.method
 * @param {string} params.accessToken
 * @param {string} [params.certificadoBase64]
 * @param {string} [params.chavePrivadaBase64]
 * @param {object} [params.body]
 * @param {object} [params.query]
 */
async function requisitar({ ambiente, path, method, accessToken, certificadoBase64, chavePrivadaBase64, body, query }) {
  _validarPathPermitido(path);
  const agent = _criarAgenteMtls(certificadoBase64, chavePrivadaBase64);
  const url = new URL(obterBaseUrl(ambiente) + path);
  if (query) {
    Object.entries(query).forEach(([chave, valor]) => {
      if (valor !== undefined && valor !== null) url.searchParams.set(chave, valor);
    });
  }

  let resp;
  try {
    resp = await fetch(url.toString(), {
      method,
      agent,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      timeout: 15000,
    });
  } catch (err) {
    throw new BankingHttpError(`Falha de rede ao chamar Itaú: ${err.message}`, { retryable: true });
  }

  const texto = await resp.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resp.ok) {
    // TODO confirmar contra sandbox real — shape de erro do Itaú ainda não
    // validado empiricamente; mantendo fallback genérico por enquanto.
    const mensagem = data?.message || data?.detail || data?.error_description || `HTTP ${resp.status} ao chamar Itaú`;

    throw new BankingHttpError(mensagem, {
      status: resp.status,
      codigoProvider: data?.code || data?.error || null,
      retryable: resp.status >= 500,
      respostaBruta: data || texto,
    });
  }

  return data;
}

/**
 * Requisição de autenticação (OAuth client_credentials) — separada de
 * `requisitar` porque não leva Bearer token (é o que gera o token).
 *
 * TODO confirmar contra sandbox real — Itaú Developers tipicamente usa
 * Basic Auth (client_id:client_secret em base64) no header Authorization
 * para o token, diferente do Inter (client_id/client_secret no body).
 * Ajustar aqui se o sandbox real rejeitar esse formato.
 *
 * @param {object} params
 * @param {string} params.ambiente
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @param {string} [params.certificadoBase64]
 * @param {string} [params.chavePrivadaBase64]
 */
async function requisitarToken({ ambiente, clientId, clientSecret, certificadoBase64, chavePrivadaBase64 }) {
  const { PATHS } = require('./itauConfig');
  const agent = _criarAgenteMtls(certificadoBase64, chavePrivadaBase64);
  const url = obterBaseUrl(ambiente) + PATHS.oauthToken;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const corpo = new URLSearchParams({ grant_type: 'client_credentials' });

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: corpo.toString(),
      timeout: 15000,
    });
  } catch (err) {
    throw new BankingHttpError(`Falha de rede ao autenticar no Itaú: ${err.message}`, { retryable: true });
  }

  const texto = await resp.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resp.ok || !data?.access_token) {
    throw new BankingHttpError(data?.error_description || data?.message || `HTTP ${resp.status} ao autenticar no Itaú`, {
      status: resp.status,
      codigoProvider: data?.error || null,
      retryable: resp.status >= 500,
      respostaBruta: data || texto,
    });
  }

  return data; // { access_token, token_type, expires_in, scope }
}

module.exports = { requisitar, requisitarToken };
