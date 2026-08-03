const { signImageAccessToken } = require('./auth');

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

const resolveBlobUrl = (pathAvatar) => {
  const avatarPath = normalizeText(pathAvatar);
  if (!avatarPath) {
    return null;
  }

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
  resolveBlobUrl
};