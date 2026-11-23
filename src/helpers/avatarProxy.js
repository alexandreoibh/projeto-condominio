const { signImageAccessToken } = require('./auth');
const { parseUrlBlob } = require('./blobUrl');

const API_AVATAR_PREFIX = '/api/condominio/usuarios';

const normalizeText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text === '' ? null : text;
};

const joinUrl = (base, resourcePath) => {
  const baseNormalized = String(base || '').replace(/\/+$/, '');
  const pathNormalized = String(resourcePath || '').replace(/^\/+/, '');
  return `${baseNormalized}/${pathNormalized}`;
};

// Resolve o caminho gravado (path_avatar, origem_imagem, origem) para uma URL
// do Vercel Blob. O resultado é buscado pelo servidor COM o token do Blob, por
// isso só são aceitas URLs https de *.blob.vercel-storage.com — qualquer
// outro host (inclusive internos) devolve null e não é buscado (anti-SSRF e
// anti-vazamento do token).
const _resolveBlobUrlCandidata = (avatarPath) => {
  if (/^https?:\/\//i.test(avatarPath)) {
    return avatarPath;
  }

  if (/^[\w.-]+\.blob\.vercel-storage\.com\//i.test(avatarPath)) {
    return `https://${avatarPath}`;
  }

  const blobStorageUrl =
    normalizeText(process.env.BLOB_STORAGE_URL) ||
    normalizeText(process.env.VERCEL_BLOB_BASE_URL) ||
    null;

  if (!blobStorageUrl) {
    return null;
  }

  return joinUrl(blobStorageUrl, avatarPath);
};

// Com `idCondominio`, o arquivo precisa estar sob /condominios/<id>/ (formato
// atual de upload) e nunca em áreas financeiras/boletos. Caminhos legados sem
// segmento de condomínio continuam aceitos se não forem financeiros.
const _caminhoPermitidoParaCondominio = (pathname, idCondominio) => {
  if (idCondominio === undefined || idCondominio === null) {
    return true;
  }
  const caminho = String(pathname || '');
  if (/\/financeiro\//i.test(caminho) || /(^|\/)cobranca\//i.test(caminho)) {
    return false;
  }
  const match = caminho.match(/\/condominios\/(\d+)\//);
  if (!match) {
    return true;
  }
  return Number.parseInt(match[1], 10) === Number.parseInt(idCondominio, 10);
};

const resolveBlobUrl = (pathAvatar, { idCondominio = null } = {}) => {
  const avatarPath = normalizeText(pathAvatar);
  if (!avatarPath) {
    return null;
  }

  const candidata = _resolveBlobUrlCandidata(avatarPath);
  const blob = candidata ? parseUrlBlob(candidata, { aceitarQualquerStoreVercel: true }) : null;
  if (!blob || !_caminhoPermitidoParaCondominio(blob.pathname, idCondominio)) {
    return null;
  }
  return blob.url.toString();
};

const isAvatarProxyUrl = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }

  return text.includes(`${API_AVATAR_PREFIX}/`) && /\/avatar(\?|$)/.test(text);
};

const getBlobReadToken = () => {
  const candidateTokens = [
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN,
    process.env.EMORADOR_READ_WRITE_TOKEN,
    process.env.BLOB_READ_WRITE_TOKEN,
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN
  ];

  const firstValid = candidateTokens
    .map((item) => normalizeText(item))
    .find((item) => Boolean(item));

  return firstValid || null;
};

const buildAvatarProxyUrl = (req, idUsuario, pathAvatar, idCondominio = null) => {
  const avatarPath = normalizeText(pathAvatar);
  if (!avatarPath) {
    return null;
  }

  const id = Number.parseInt(idUsuario, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const imageToken = signImageAccessToken({
    tipo: 'avatar_usuario',
    id,
    id_condominio: Number.parseInt(idCondominio ?? req?.id_condominio, 10) || null
  });
  const relativePath = `${API_AVATAR_PREFIX}/${id}/avatar?token=${imageToken}`;
  const forwardedHost = normalizeText(req?.headers?.['x-forwarded-host']);
  const host = forwardedHost || normalizeText(req?.get?.('host'));
  const forwardedProtoRaw = normalizeText(req?.headers?.['x-forwarded-proto']);
  const forwardedProto = forwardedProtoRaw ? forwardedProtoRaw.split(',')[0].trim() : null;
  const protocol = forwardedProto || normalizeText(req?.protocol) || 'https';

  if (!host) {
    return relativePath;
  }

  return `${protocol}://${host}${relativePath}`;
};

const buildDashboardImagemProxyUrl = (req, idRegistro, origemImagem, idCondominio = null) => {
  if (!normalizeText(origemImagem)) {
    return null;
  }

  const id = Number.parseInt(idRegistro, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const imageToken = signImageAccessToken({
    tipo: 'dashboard_registro',
    id,
    id_condominio: Number.parseInt(idCondominio ?? req?.id_condominio, 10) || null
  });
  const relativePath = `/api/condominio/dashboard/registros/${id}/imagem?token=${imageToken}`;
  const forwardedHost = normalizeText(req?.headers?.['x-forwarded-host']);
  const host = forwardedHost || normalizeText(req?.get?.('host'));
  const forwardedProtoRaw = normalizeText(req?.headers?.['x-forwarded-proto']);
  const forwardedProto = forwardedProtoRaw ? forwardedProtoRaw.split(',')[0].trim() : null;
  const protocol = forwardedProto || normalizeText(req?.protocol) || 'https';

  if (!host) {
    return relativePath;
  }

  return `${protocol}://${host}${relativePath}`;
};

const buildConsumoImagemProxyUrl = (req, idRegistro, origemImagem, idCondominio = null) => {
  if (!normalizeText(origemImagem)) {
    return null;
  }

  const id = Number.parseInt(idRegistro, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const imageToken = signImageAccessToken({
    tipo: 'consumo_registro',
    id,
    id_condominio: Number.parseInt(idCondominio ?? req?.id_condominio, 10) || null
  });
  const relativePath = `/api/condominio/consumo/registros/${id}/imagem?token=${imageToken}`;
  const forwardedHost = normalizeText(req?.headers?.['x-forwarded-host']);
  const host = forwardedHost || normalizeText(req?.get?.('host'));
  const forwardedProtoRaw = normalizeText(req?.headers?.['x-forwarded-proto']);
  const forwardedProto = forwardedProtoRaw ? forwardedProtoRaw.split(',')[0].trim() : null;
  const protocol = forwardedProto || normalizeText(req?.protocol) || 'https';

  if (!host) {
    return relativePath;
  }

  return `${protocol}://${host}${relativePath}`;
};

module.exports = {
  buildAvatarProxyUrl,
  buildConsumoImagemProxyUrl,
  buildDashboardImagemProxyUrl,
  getBlobReadToken,
  isAvatarProxyUrl,
  resolveBlobUrl
};