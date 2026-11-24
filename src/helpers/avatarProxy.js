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

// Áreas de imagem servidas pelos proxies. O caminho precisa ser o gerado pelo
// upload do backend: <env>/condominios/<id>/<área>/.../imagem|avatar/vN.<ext>
// com extensão de imagem. Incidente 22/11/2026: antes, qualquer caminho sem
// segmento de condomínio era aceito e o conteúdo era servido com o
// Content-Type do Blob (ex.: sh.php, xxe.svg apontados via path_avatar).
const REGEX_AREA = {
  avatar: /^\/[^/]+\/condominios\/(\d+)\/usuarios\/\d+\/avatar\/[^/]+\.(?:jpe?g|png|webp|gif|heic)$/i,
  consumo: /^\/[^/]+\/condominios\/(\d+)\/consumo\/registros\/\d+\/imagem\/[^/]+\.(?:jpe?g|png|webp|gif|heic)$/i,
  dashboard: /^\/[^/]+\/condominios\/(\d+)\/dashboard\/registros\/tipo\d+\/\d+\/imagem\/[^/]+\.(?:jpe?g|png|webp|gif|heic)$/i
};

const _caminhoPermitido = (pathname, idCondominio, area) => {
  const regex = REGEX_AREA[area];
  if (!regex) return false;
  const match = String(pathname || '').match(regex);
  if (!match) return false;
  if (idCondominio === undefined || idCondominio === null) return false;
  return Number.parseInt(match[1], 10) === Number.parseInt(idCondominio, 10);
};

// `area` é obrigatória ('avatar' | 'consumo' | 'dashboard').
const resolveBlobUrl = (pathAvatar, { idCondominio = null, area = null } = {}) => {
  const avatarPath = normalizeText(pathAvatar);
  if (!avatarPath) {
    return null;
  }

  const candidata = _resolveBlobUrlCandidata(avatarPath);
  const blob = candidata ? parseUrlBlob(candidata, { aceitarQualquerStoreVercel: true }) : null;
  if (!blob || !_caminhoPermitido(blob.pathname, idCondominio, area)) {
    return null;
  }
  return blob.url.toString();
};

// Valor de path_avatar/origem_imagem/origem recebido no body: só aceita
// vazio ou um caminho que o próprio proxy serviria para aquele condomínio.
const caminhoImagemValidoParaGravar = (valor, { idCondominio, area }) => {
  const texto = normalizeText(valor);
  if (!texto) return true;
  if (isAvatarProxyUrl(texto)) return true;
  return resolveBlobUrl(texto, { idCondominio, area }) !== null;
};

const CONTENT_TYPE_IMAGEM = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' };

const contentTypeImagemSegura = (url) => {
  let pathname = '';
  try {
    pathname = new URL(String(url)).pathname;
  } catch (_) {
    pathname = String(url || '');
  }
  const ext = (pathname.split('.').pop() || '').toLowerCase();
  return CONTENT_TYPE_IMAGEM[ext] || 'application/octet-stream';
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
  resolveBlobUrl,
  caminhoImagemValidoParaGravar,
  contentTypeImagemSegura
};