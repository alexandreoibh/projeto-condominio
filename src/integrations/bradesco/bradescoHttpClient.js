'use strict';

const https = require('https');
const fetch = require('node-fetch');
const { obterBaseUrl } = require('./bradescoConfig');
const BankingHttpError = require('../shared/bankingHttpError');

/**
 * mTLS é sempre obrigatório no Bradesco (confirmado no guia do portal:
 * nenhuma credencial é gerada sem anexar certificado) — diferente do Itaú,
 * onde ficou opcional por incerteza. Igual ao Inter, sem fallback undefined.
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

// RESTRIÇÃO DE SEGURANÇA DELIBERADA (mesma exigência de produto aplicada ao
// Inter e ao Itaú): o e-Morador só pode RECEBER dinheiro, nunca mover
// dinheiro para fora da conta do condomínio. Esta allowlist cobre só os
// endpoints de registro/consulta/baixa de boleto de COBRANÇA (recebimento)
// e extrato/saldo — nenhum path da collection "Cobrança Pagamento -
// Cliente" (paga boletos de terceiros a partir da conta, dinheiro saindo)
// foi incluído aqui, nem deve ser, mesmo que solicitado no futuro.
const PREFIXOS_PATH_PERMITIDOS = [
  '/boleto/cobranca-registro',        // registrar boleto de cobrança (receber)
  '/boleto/cobranca-altera',          // alterar título já registrado
  '/boleto/cobranca-consulta',        // consultar título específico
  '/boleto/cobranca-baixa',           // baixar (cancelar) título
  '/boleto/cobranca-webhook',         // cadastrar webhook de cobrança
  '/v1/fornecimento-extratos-contas', // extrato, somente leitura
  '/v1/fornecimento-saldos-contas',   // saldo, somente leitura
];

function _validarPathPermitido(path) {
  const caminho = path.split('?')[0];
  const permitido = PREFIXOS_PATH_PERMITIDOS.some((prefixo) => caminho.startsWith(prefixo));
  if (!permitido) {
    throw new Error(
      `Chamada bloqueada por política de segurança: "${caminho}" não está na allowlist de endpoints permitidos ` +
      `(o e-Morador não pode realizar pagamentos/transferências de saída via API do Bradesco).`
    );
  }
}

/**
 * Requisição autenticada (Bearer + mTLS) a um endpoint de negócio do
 * Bradesco. Aceita GET (extrato/saldo, com query string) e POST/PUT
 * (boleto, com body JSON) — confirmado nas collections que todas as
 * operações de boleto usam POST/PUT, mesmo consultas e listagens.
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
    throw new BankingHttpError(`Falha de rede ao chamar Bradesco: ${err.message}`, { retryable: true });
  }

  const texto = await resp.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resp.ok) {
    // Formato de erro confirmado via collection (exemplo real de resposta
    // 400 no endpoint de extrato): { codigoErro, descricao } — diferente do
    // Inter (violacoes[]) e do Itaú (message/detail).
    const mensagem = data?.descricao || data?.message || `HTTP ${resp.status} ao chamar Bradesco`;

    throw new BankingHttpError(mensagem, {
      status: resp.status,
      codigoProvider: data?.codigoErro || null,
      retryable: resp.status >= 500,
      respostaBruta: data || texto,
    });
  }

  return data;
}

/**
 * Requisição de autenticação (OAuth client_credentials). Confirmado via
 * collection: client_id/client_secret vão no body form-urlencoded (não
 * Basic Auth como o Itaú) — mesmo padrão do Inter. Sem parâmetro de scope
 * (não há esse campo nos exemplos de token da collection).
 *
 * @param {object} params
 * @param {string} params.ambiente
 * @param {string} params.clientId
 * @param {string} params.clientSecret
 * @param {string} params.certificadoBase64
 * @param {string} params.chavePrivadaBase64
 */
async function requisitarToken({ ambiente, clientId, clientSecret, certificadoBase64, chavePrivadaBase64 }) {
  const { PATHS } = require('./bradescoConfig');
  const agent = _criarAgenteMtls(certificadoBase64, chavePrivadaBase64);
  const url = obterBaseUrl(ambiente) + PATHS.oauthToken;

  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

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
    throw new BankingHttpError(`Falha de rede ao autenticar no Bradesco: ${err.message}`, { retryable: true });
  }

  const texto = await resp.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resp.ok || !data?.access_token) {
    throw new BankingHttpError(data?.descricao || data?.error_description || data?.message || `HTTP ${resp.status} ao autenticar no Bradesco`, {
      status: resp.status,
      codigoProvider: data?.codigoErro || data?.error || null,
      retryable: resp.status >= 500,
      respostaBruta: data || texto,
    });
  }

  return data; // { access_token, ... }
}

module.exports = { requisitar, requisitarToken };
