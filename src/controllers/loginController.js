"use strict";

const jwt = require("jsonwebtoken");
const CryptoJS = require("crypto-js");
const { QueryTypes } = require("sequelize");
const postgres = require("../database/postgres");

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const CHAVE = process.env.CHAVE;

class Login {
  _extractCredentials(req) {
    const loginValue = (
      req.body?.login ||
      req.body?.email ||
      req.query.dt1 ||
      req.query.login ||
      ""
    )
      .toString()
      .trim()
      .toLowerCase();

    const passwordValue = (
      req.body?.password ||
      req.body?.senha ||
      req.query.dt2 ||
      req.query.password ||
      ""
    ).toString();

    return {
      login: loginValue,
      password: passwordValue
    };
  }

  async login(req, res) {
    return this.index(req, res);
  }

  async index(req, res) {
    try {
      const { login, password } = this._extractCredentials(req);

      if (!login || !password) {
        return res.status(400).send({
          check: false,
          message: "Informe login e senha no body (POST) ou query (legado)."
        });
      }

      const user = await postgres.query(
        `SELECT id, matricula, nome, email, telefone, id_perfil, cpf, status, id_empresa,
                img, imgb, last_online, theme, idioma, senha
           FROM sgw.tb_usuario
          WHERE lower(email) = :login OR lower(matricula) = :login
          LIMIT 1`,
        {
          replacements: { login },
          type: QueryTypes.SELECT
        }
      );

      const result = user && user.length > 0 ? user[0] : null;
      if (!result) {
        return res.send({
          check: false,
          message: "Usuário ou senha inválidos."
        });
      }

      let passwordOk = result.senha === password;
      if (!passwordOk && CHAVE && result.senha) {
        const bytes = CryptoJS.AES.decrypt(result.senha, CHAVE);
        const originalText = bytes.toString(CryptoJS.enc.Utf8);
        passwordOk = originalText === password;
      }

      if (!passwordOk) {
        return res.send({
          check: false,
          message: "Usuário ou senha inválidos."
        });
      }

      const token = jwt.sign(
        {
          apelido: result.email,
          IdPerfil: result.id_perfil,
          id: result.id,
          email: result.email,
          empresa: "condominio"
        },
        JWT_SECRET,
        { expiresIn: "1d" }
      );

      return res.send({
        id: result.id,
        matricula: result.matricula,
        nome: result.nome,
        email: result.email,
        telefone: result.telefone,
        token,
        msg: "",
        id_perfil: result.id_perfil,
        cpf: result.cpf,
        status: result.status,
        id_empresa: result.id_empresa,
        check: true,
        role: "morador",
        img: result.img,
        imgb: result.imgb,
        nome_empresa: "Condomínio",
        last_online: result.last_online,
        theme: result.theme,
        idioma: result.idioma
      });
    } catch (error) {
      return res.status(500).send({
        check: false,
        message: "Erro no login.",
        detail: error.message
      });
    }
  }
}

module.exports = Login;
