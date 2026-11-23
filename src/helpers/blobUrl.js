'use strict';

// Validação de URLs do Vercel Blob antes de qualquer fetch com o token de
// leitura/escrita. Compara host e caminho já parseados (new URL), nunca por
// startsWith/includes na string — isso permitia hosts como
// "<store>.blob.vercel-storage.com.atacante.tld" e caminhos na query string.

const crypto = require('crypto');
const { getJwtSecret } = require('./segredos');

const LINK_ASSINADO_TTL_SEGUNDOS = 60 * 60 * 24 * 45; // 45 dias (links de e-mail)

function _hostsPermitidos() {
  const hosts = new Set();
  for (const base of [process.env.BLOB_STORAGE_URL, process.env.BLOB_PUBLIC_STORAGE_URL, process.env.VERCEL_BLOB_BASE_URL]) {
    if (!base) continue;
    try {
      hosts.add(new URL(base).host.toLowerCase());
    } catch (_) {
      // ignora valor inválido
    }
  }
  return hosts;
}

function _ehHostVercelBlob(host) {
  return /^[a-z0-9-]+\.(public|private)\.blob\.vercel-storage\.com$/i.test(host)
    || /^[a-z0-9-]+\.blob\.vercel-storage\.com$/i.test(host);
}

// Retorna { url: URL, pathname } se a URL for do Blob configurado, senão null.
// Com `aceitarQualquerStoreVercel`, aceita qualquer host *.blob.vercel-storage.com
// (útil para leitura de arquivos já gravados quando BLOB_STORAGE_URL não está
// definida), mas NUNCA um host de terceiros.
function parseUrlBlob(valor, { aceitarQualquerStoreVercel = false } = {}) {
  if (!valor) return null;
  let url;
  try {
    url = new URL(String(valor));
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;

  const host = url.host.toLowerCase();
  const permitidos = _hostsPermitidos();
  const hostOk = permitidos.has(host) || (aceitarQualquerStoreVercel && _ehHostVercelBlob(host));
  if (!hostOk) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (_) {
    return null;
  }
  if (pathname.includes('..') || pathname.includes('\\')) return null;

  return { url, pathname };
}

function _chaveAssinatura() {
  return crypto.createHmac('sha256', getJwtSecret()).update('blob-download-link:v1').digest();
}

function _assinar(urlTexto, exp) {
  return crypto.createHmac('sha256', _chaveAssinatura()).update(`${exp}.${urlTexto}`).digest('base64url');
}

// Gera os parâmetros de um link de download assinado (sem login), usado nos
// e-mails de cobrança.
function assinarLinkDownload(urlTexto, ttlSegundos = LINK_ASSINADO_TTL_SEGUNDOS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSegundos;
  return { exp, sig: _assinar(String(urlTexto), exp) };
}

function verificarLinkDownload(urlTexto, exp, sig) {
  const expNum = Number.parseInt(exp, 10);
  if (!Number.isInteger(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  if (!sig) return false;
  const esperado = Buffer.from(_assinar(String(urlTexto), expNum));
  const recebido = Buffer.from(String(sig));
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

module.exports = {
  parseUrlBlob,
  assinarLinkDownload,
  verificarLinkDownload,
  LINK_ASSINADO_TTL_SEGUNDOS
};
