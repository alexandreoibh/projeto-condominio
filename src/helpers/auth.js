var jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).send({ message: "Token necessário" });
    }

    const token = authHeader.split(" ")[1];
    const verify = await jwt.verify(token, JWT_SECRET);

    req.apelido = verify.apelido || verify.email || "";
    req.idcliente = verify.id || null;
    req.emailUsuario = verify.email || "";
    req.cpf = verify.cpf || "";
    req.ssss = verify.ssss || "";
    req.IdPerfil = verify.IdPerfil || null;
    req.empresa = verify.empresa || "condominio";
    req.nomePerfil = verify.role || "";

    return next();
  } catch (err) {
    return res.status(401).send({ message: "Token inválido", detail: err.message });
  }
};
