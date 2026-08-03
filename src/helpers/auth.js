var jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const IMAGE_TOKEN_TTL = '5m';

const extractTokenFromRequest = (req) => {
  const authHeader = req.header("Authorization") || req.header("authorization");

  if (authHeader) {
    const raw = String(authHeader).trim();
    if (raw.toLowerCase().startsWith("bearer ")) {
      const parts = raw.split(" ");
      if (parts[1]) {
        return parts[1].trim();
      }
    }

    // Compatibilidade: alguns clientes legados enviam apenas o token no Authorization.
    if (raw.length > 20 && raw.split('.').length === 3) {
      return raw;
    }
  }

  const headerToken =
    req.header("x-access-token") ||
    req.header("X-Access-Token") ||
    req.header("token") ||
    req.header("Token");

  if (headerToken && String(headerToken).trim().split('.').length === 3) {
    return String(headerToken).trim();
  }

  const queryToken = req.query?.token;
  if (queryToken && String(queryToken).trim().split('.').length === 3) {
    return String(queryToken).trim();
  }

  const bodyToken = req.body?.token;
  if (bodyToken && String(bodyToken).trim().split('.').length === 3) {
    return String(bodyToken).trim();
  }

  return null;
};

const auth = async (req, res, next) => {
  try {
    const token = extractTokenFromRequest(req);

    if (!token) {
      return res.status(401).send({ message: "Token necessário" });
    }

    const verify = await jwt.verify(token, JWT_SECRET);

    req.token = token;
    req.apelido = verify.apelido || verify.email || "";
    req.idcliente = verify.id || null;
    req.emailUsuario = verify.email || "";
    req.cpf = verify.cpf || "";
    req.ssss = verify.ssss || "";
    req.IdPerfil = verify.IdPerfil || null;
    req.id_condominio = verify.id_condominio || null;
    req.id_unidade = verify.id_unidade || null;
    req.empresa = verify.empresa || "condominio";
    req.nomePerfil = verify.nome_perfil || verify.role || "";

    return next();
  } catch (err) {
    return res.status(401).send({ message: "Token inválido", detail: err.message });
  }
};

const signImageAccessToken = ({ tipo, id, id_condominio }) => {
  return jwt.sign({ tipo, id, id_condominio }, JWT_SECRET, { expiresIn: IMAGE_TOKEN_TTL });
};

const verifyImageAccessToken = (token, tipoEsperado) => {
  const payload = jwt.verify(token, JWT_SECRET, { maxAge: IMAGE_TOKEN_TTL });
  if (!payload || payload.tipo !== tipoEsperado) {
    throw new Error('Token de imagem não corresponde ao recurso solicitado.');
  }
  return payload;
};

const authOrImageToken = (tipoEsperado) => async (req, res, next) => {
  const queryToken = req.query?.token ? String(req.query.token).trim() : null;

  if (queryToken) {
    try {
      const payload = verifyImageAccessToken(queryToken, tipoEsperado);
      req.id_condominio = payload.id_condominio || null;
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
