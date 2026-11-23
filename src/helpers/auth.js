'use strict';

const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./segredos');
const { lerEstadoSessao } = require('./sessao');

const IMAGE_TOKEN_TTL = '5m';
const IMAGE_TOKEN_AUDIENCE = 'image';

const _pareceJwt = (valor) => {
  const texto = valor === undefined || valor === null ? '' : String(valor).trim();
  return texto.length > 20 && texto.split('.').length === 3 ? texto : null;
};

const extractTokenFromRequest = (req) => {
  const authHeader = req.header('Authorization') || req.header('authorization');

  if (authHeader) {
    const raw = String(authHeader).trim();
    if (raw.toLowerCase().startsWith('bearer ')) {
      const parts = raw.split(' ');
      if (parts[1]) {
        return parts[1].trim();
      }
    }

    // Compatibilidade: alguns clientes legados enviam apenas o token no Authorization.
    const legado = _pareceJwt(raw);
    if (legado) {
      return legado;
    }
  }

  const headerToken =
    req.header('x-access-token') ||
    req.header('X-Access-Token') ||
    req.header('token') ||
    req.header('Token');

  const viaHeader = _pareceJwt(headerToken);
  if (viaHeader) {
    return viaHeader;
  }

  const viaQuery = _pareceJwt(req.query?.token);
  if (viaQuery) {
    return viaQuery;
  }

  const viaBody = _pareceJwt(req.body?.token);
  if (viaBody) {
    return viaBody;
  }

  return null;
};

// Um JWT de sessão é o emitido pelo login (loginController). Tokens de imagem
// (aud=image / claim tipo), de convite e de recuperação (claim flow) são
// assinados para outros fins e NUNCA valem como sessão.
const _ehPayloadDeSessao = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.aud !== undefined) return false;
  if (payload.tipo !== undefined) return false;
  if (payload.flow !== undefined) return false;
  const id = Number.parseInt(payload.id, 10);
  return Number.isInteger(id) && id > 0;
};

// Verifica assinatura, expiração, finalidade, status do usuário e
// token_version. Lança erro com .status em caso de recusa.
const verificarTokenDeSessao = async (token) => {
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  } catch (err) {
    const erro = new Error('Token inválido');
    erro.status = 401;
    throw erro;
  }

  if (!_ehPayloadDeSessao(payload)) {
    const erro = new Error('Token inválido');
    erro.status = 401;
    throw erro;
  }

  const estado = await lerEstadoSessao(payload.id);
  if (!estado || !estado.existe || estado.status !== 'ativo') {
    const erro = new Error('Sessão inválida');
    erro.status = 401;
    throw erro;
  }

  // Tokens emitidos antes do token_version não têm `tv` → tratados como 0.
  const versaoToken = Number.parseInt(payload.tv, 10) || 0;
  if (estado.versao !== null && versaoToken !== estado.versao) {
    const erro = new Error('Sessão expirada');
    erro.status = 401;
    throw erro;
  }

  return payload;
};

const _popularRequest = (req, token, verify) => {
  req.token = token;
  req.apelido = verify.apelido || verify.email || '';
  req.idcliente = verify.id || null;
  req.emailUsuario = verify.email || '';
  req.cpf = verify.cpf || '';
  req.ssss = verify.ssss || '';
  req.IdPerfil = verify.IdPerfil || null;
  req.id_condominio = verify.id_condominio || null;
  req.id_unidade = verify.id_unidade || null;
  req.empresa = verify.empresa || 'condominio';
  req.nomePerfil = verify.nome_perfil || verify.role || '';
  req.authTipo = 'sessao';
};

const auth = async (req, res, next) => {
  const token = extractTokenFromRequest(req);

  if (!token) {
    return res.status(401).send({ message: 'Token necessário' });
  }

  let verify;
  try {
    verify = await verificarTokenDeSessao(token);
  } catch (err) {
    if (err && err.status === 401) {
      return res.status(401).send({ message: err.message || 'Token inválido' });
    }
    console.error('[auth] Falha ao validar sessão:', err?.message);
    return res.status(503).send({ message: 'Não foi possível validar a sessão. Tente novamente.' });
  }

  _popularRequest(req, token, verify);
  return next();
};

const signImageAccessToken = ({ tipo, id, id_condominio }) => {
  return jwt.sign({ tipo, id, id_condominio }, getJwtSecret(), {
    expiresIn: IMAGE_TOKEN_TTL,
    audience: IMAGE_TOKEN_AUDIENCE
  });
};

const verifyImageAccessToken = (token, tipoEsperado) => {
  const payload = jwt.verify(token, getJwtSecret(), {
    maxAge: IMAGE_TOKEN_TTL,
    audience: IMAGE_TOKEN_AUDIENCE,
    algorithms: ['HS256']
  });
  if (!payload || payload.tipo !== tipoEsperado) {
    throw new Error('Token de imagem não corresponde ao recurso solicitado.');
  }
  return payload;
};

// O token de imagem só autoriza a leitura daquele recurso: não define
// idcliente/IdPerfil, então não serve como sessão em nenhum outro handler.
const authOrImageToken = (tipoEsperado) => async (req, res, next) => {
  const queryToken = req.query?.token ? String(req.query.token).trim() : null;

  if (queryToken) {
    try {
      const payload = verifyImageAccessToken(queryToken, tipoEsperado);
      req.id_condominio = payload.id_condominio || null;
      req.imageTokenRecursoId = payload.id ?? null;
      req.authTipo = 'imagem';
      return next();
    } catch (imageTokenError) {
      // token de imagem inválido/expirado — cai para o fluxo de auth normal abaixo
    }
  }

  return auth(req, res, next);
};

module.exports = auth;
module.exports.signImageAccessToken = signImageAccessToken;
module.exports.verifyImageAccessToken = verifyImageAccessToken;
module.exports.authOrImageToken = authOrImageToken;
module.exports.extractTokenFromRequest = extractTokenFromRequest;
module.exports.verificarTokenDeSessao = verificarTokenDeSessao;
