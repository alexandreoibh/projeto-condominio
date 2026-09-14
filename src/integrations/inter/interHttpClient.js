'use strict';

const https = require('https');
const fetch = require('node-fetch');
const { obterBaseUrl } = require('./interConfig');
const BankingHttpError = require('../shared/bankingHttpError');

/**
 * Monta o agente HTTPS com o certificado mTLS daquele condomínio. Não há
 * filesystem persistente confiável em serverless, então o Agent é
 * recriado a cada invocação — é barato o suficiente para não valer a pena
 * cachear entre cold starts.
 *
 * @param {string} certificadoBase64
 * @param {string} chavePrivadaBase64
 */
function _criarAgenteMtls(certificadoBase64, chavePrivadaBase64) {
  return new https.Agent({
    cert: Buffer.from(certificadoBase64, 'base64'),
    key: Buffer.from(chavePrivadaBase64, 'base64'),
  });
}

// RESTRIÇÃO DE SEGURANÇA DELIBERADA (exigência de produto): o e-Morador só
// pode RECEBER dinheiro, nunca mover dinheiro para fora da conta do
// condomínio. Esta allowlist bloqueia fisicamente qualquer chamada a
// endpoints de pagamento/transferência de saída do Inter (/banking/v2/pagamento,
// /banking/v2/pix de saída, DARF, lote de pagamento), mesmo que alguém
// tente implementar isso no futuro por engano — é a segunda camada de
// defesa, complementar à omissão desses escopos em interAuthClient.js.
const PREFIXOS_PATH_PERMITIDOS = [
  '/cobranca/v3/cobrancas', // emitir/consultar/cancelar boleto (receber)
  '/banking/v2/extrato',    // consulta, somente leitura
  '/banking/v2/saldo',      // consulta, somente leitura
  '/banking/v2/webhooks',   // configurar webhook de banking (não move dinheiro)
  '/pix/v2/cob',            // Pix cobrança imediata (receber)
  '/pix/v2/cobv',           // Pix cobrança com vencimento (receber)
  '/pix/v2/lotecobv',       // consulta de lote de cobrança com vencimento
  '/pix/v2/loc',            // location/QR code de cobrança
  '/pix/v2/pix',            // consulta de Pix recebidos/devolução
  '/pix/v2/webhook',        // configurar webhook Pix
];

function _validarPathPermitido(path) {
  const caminho = path.split('?')[0];
  const permitido = PREFIXOS_PATH_PERMITIDOS.some((prefixo) => caminho.startsWith(prefixo));
  if (!permitido) {
    throw new Error(
      `Chamada bloqueada por política de segurança: "${caminho}" não está na allowlist de endpoints permitidos ` +
      `(o e-Morador não pode realizar pagamentos/transferências de saída via API do Inter).`
    );
  }
}

/**
 * Requisição autenticada (Bearer + mTLS) a um endpoint de negócio do Inter.
 * Não faz retry aqui — retry é decisão de negócio de quem chama.
 *
 * @param {object} params
 * @param {string} params.ambiente 'sandbox' | 'production'
 * @param {string} params.path
 * @param {string} params.method
 * @param {string} params.accessToken
 * @param {string} params.certificadoBase64
 * @param {string} params.chavePrivadaBase64
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
    throw new BankingHttpError(`Falha de rede ao chamar Inter: ${err.message}`, { retryable: true });
  }

  const texto = await resp.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resp.ok) {
    // O Inter retorna erros de validação em "violacoes" (razao/propriedade),
    // não em "message" — sem isso a mensagem de erro fica genérica demais
    // para diagnosticar (ex: "Verifique se os dados..." em vez do motivo real).
    const violacoes = Array.isArray(data?.violacoes)
      ? data.violacoes.map((v) => `${v.propriedade ? v.propriedade + ': ' : ''}${v.razao}`).join('; ')
      : null;
    const mensagem = violacoes || data?.message || data?.detail || `HTTP ${resp.status} ao chamar Inter`;

    throw new BankingHttpError(mensagem, {
      status: resp.status,
      codigoProvider: data?.title || data?.code || null,
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
 * @param {object} params
 * @param {string} params.ambiente
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @param {string} params.certificadoBase64
 * @param {string} params.chavePrivadaBase64
 * @param {string} [params.escopo]
 */
async function requisitarToken({ ambiente, clientId, clientSecret, certificadoBase64, chavePrivadaBase64, escopo }) {
  const { PATHS } = require('./interConfig');
  const agent = _criarAgenteMtls(certificadoBase64, chavePrivadaBase64);
  const url = obterBaseUrl(ambiente) + PATHS.oauthToken;

  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (escopo) corpo.set('scope', escopo);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      agent,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
      timeout: 15000,
    });
  } catch (err) {
    throw new BankingHttpError(`Falha de rede ao autenticar no Inter: ${err.message}`, { retryable: true });
  }

  const texto = await resp.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resp.ok || !data?.access_token) {
    throw new BankingHttpError(data?.error_description || data?.message || `HTTP ${resp.status} ao autenticar no Inter`, {
      status: resp.status,
      codigoProvider: data?.error || null,
      retryable: resp.status >= 500,
      respostaBruta: data || texto,
    });
  }

  return data; // { access_token, token_type, expires_in, scope }
}

module.exports = { requisitar, requisitarToken };
