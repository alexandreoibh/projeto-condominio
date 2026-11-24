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

// Content-Type de resposta definido pelo servidor (allowlist por extensão),
// nunca o devolvido pelo Blob: um objeto gravado com text/html ou image/svg+xml
// não pode ser servido como tal a partir da origem da API.
const CONTENT_TYPE_POR_EXTENSAO = Object.freeze({
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
});

const EXTENSOES_IMAGEM = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic']);

function nomeArquivoSeguro(pathname, padrao = 'arquivo') {
  const nome = String(pathname || '').split('/').pop() || padrao;
  return nome.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150) || padrao;
}

function extensaoDoPath(pathname) {
  const nome = String(pathname || '').split('/').pop() || '';
  const partes = nome.split('.');
  return partes.length > 1 ? partes.pop().toLowerCase() : '';
}

function contentTypeSeguro(pathname) {
  return CONTENT_TYPE_POR_EXTENSAO[extensaoDoPath(pathname)] || 'application/octet-stream';
}

// Confere se a URL é do Blob configurado (host exato), com o pathname
// casando `regexPath` e, quando `idCondominio` é informado, dentro de
// /condominios/<idCondominio>/. Retorna { url, pathname } ou null.
function validarUrlBlobDoCondominio(valor, { regexPath = null, idCondominio = null } = {}) {
  const blob = parseUrlBlob(valor);
  if (!blob) return null;
  if (regexPath && !regexPath.test(blob.pathname)) return null;
  if (idCondominio !== null && idCondominio !== undefined) {
    const match = blob.pathname.match(/^\/[^/]+\/condominios\/(\d+)\//);
    if (!match || Number.parseInt(match[1], 10) !== Number.parseInt(idCondominio, 10)) return null;
  }
  return blob;
}

// Busca um objeto privado do Blob com o token de leitura. O token só é
// enviado ao host exato do store (parseUrlBlob) e redirecionamentos são
// recusados, para que a credencial nunca siga para outro host.
async function buscarBlobPrivado(blob, { token = process.env.BLOB_READ_WRITE_TOKEN, fetchImpl = fetch } = {}) {
  if (!blob || !blob.url) {
    throw new Error('URL do Blob não validada.');
  }
  if (!token) {
    const erro = new Error('Token do Blob não configurado.');
    erro.status = 500;
    throw erro;
  }
  return fetchImpl(blob.url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error'
  });
}

// Envia o conteúdo com cabeçalhos seguros. Imagens podem ir inline; o resto
// sempre como attachment.
function enviarArquivoBlob(res, buffer, pathname, { inlineImagem = false, nomePadrao = 'arquivo' } = {}) {
  const extensao = extensaoDoPath(pathname);
  const nome = nomeArquivoSeguro(pathname, nomePadrao);
  const inline = inlineImagem && EXTENSOES_IMAGEM.has(extensao);
  res.setHeader('Content-Type', contentTypeSeguro(pathname));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${nome}"`);
  return res.status(200).send(buffer);
}

module.exports = {
  parseUrlBlob,
  validarUrlBlobDoCondominio,
  buscarBlobPrivado,
  enviarArquivoBlob,
  contentTypeSeguro,
  nomeArquivoSeguro,
  extensaoDoPath,
  CONTENT_TYPE_POR_EXTENSAO,
  assinarLinkDownload,
  verificarLinkDownload,
  LINK_ASSINADO_TTL_SEGUNDOS
};
