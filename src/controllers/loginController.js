"use strict";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { QueryTypes } = require("sequelize");
const postgres = require("../database/postgres");

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";

class Login {
  _normalizeCpf(value) {
    return (value || "").toString().replace(/\D/g, "").trim();
  }

  _extractCredentials(req) {
    const loginValue = (
      req.body?.login ||
      req.body?.email ||
      ""
    )
      .toString()
      .trim()
      .toLowerCase();

    const passwordValue = (
      req.body?.password ||
      req.body?.senha ||
      ""
    ).toString();

    return {
      login: loginValue,
      password: passwordValue
    };
  }

  async _isPasswordValid(password, passwordHash) {
    if (!passwordHash) {
      return false;
    }

    if (passwordHash.startsWith("$2a$") || passwordHash.startsWith("$2b$") || passwordHash.startsWith("$2y$")) {
      return bcrypt.compare(password, passwordHash);
    }

    return password === passwordHash;
  }

  async login(req, res) {
    return this.index(req, res);
  }

  async index(req, res) {
    try {
      const { login, password } = this._extractCredentials(req);
      const cpf = this._normalizeCpf(login);

      if (!login || !password) {
        return res.status(400).send({
          check: false,
          message: "Informe login e senha no body (POST)."
        });
      }

      const user = await postgres.query(
        `SELECT id, id_condominio, nome, sobrenome, cpf, email, telefone, tipo_perfil_id, tipo, status,
                senha_hash, last_login_at, created_at, updated_at
           FROM "condominio-bh"."tb-usuarios"
          WHERE (lower(email) = :loginEmail OR cpf = :loginCpf)
            AND status in ('ativo','Ativo')
          LIMIT 1`,
        {
          replacements: {
            loginEmail: login,
            loginCpf: cpf
          },
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

      const passwordOk = await this._isPasswordValid(password, result.senha_hash);

      if (!passwordOk) {
        return res.send({
          check: false,
          message: "Usuário ou senha inválidos."
        });
      }

      await postgres.query(
        `UPDATE "condominio-bh"."tb-usuarios"
            SET last_login_at = now(), updated_at = now()
          WHERE id = :id`,
        {
          replacements: { id: result.id },
          type: QueryTypes.UPDATE
        }
      );

      const token = jwt.sign(
        {
          apelido: result.email || result.cpf,
          IdPerfil: result.tipo_perfil_id || null,
          id: result.id,
          email: result.email,
          cpf: result.cpf,
          role: result.tipo,
          id_condominio: result.id_condominio,
          empresa: "condominio"
        },
        JWT_SECRET,
        { expiresIn: "1d" }
      );

      return res.send({
        id: result.id,
        id_condominio: result.id_condominio,
        matricula: result.cpf,
        nome: `${result.nome || ""} ${result.sobrenome || ""}`.trim(),
        email: result.email,
        telefone: result.telefone,
        token,
        msg: "",
        id_perfil: result.tipo_perfil_id || null,
        cpf: result.cpf,
        status: result.status,
        id_empresa: result.id_condominio,
        check: true,
        role: result.tipo,
        img: null,
        imgb: null,
        nome_empresa: "Condomínio",
        last_online: result.last_login_at,
        theme: null,
        idioma: null
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
