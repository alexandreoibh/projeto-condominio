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
        `SELECT
            tu.id,
            tu.id_condominio,
            c.nome AS nome_condominio,
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.telefone,
            tu.path_avatar,
            tu.tipo_morador,
            tu.apartamento,
            tu.bloco,
            tu.tipo_perfil_id,
            p.nome AS nome_perfil,
            tu.tipo,
            tu.status,
            tu.senha_hash,
            tu.last_login_at,
            tu.created_at,
            tu.updated_at
           FROM "condominio-bh"."tb-usuarios" tu
           LEFT JOIN "condominio-bh".tb_sgw_perfil p
               ON p.id::text = tu.tipo_perfil_id::text
           LEFT JOIN "condominio-bh"."tb-condominios" c
               ON c.id::text = tu.id_condominio::text
          WHERE (lower(tu.email) = :loginEmail OR tu.cpf = :loginCpf)
            AND tu.status in ('ativo','Ativo')
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
          id_perfil: result.tipo_perfil_id || null,
          nome_perfil: result.nome_perfil || result.tipo || null,
          id: result.id,
          nome: result.nome || null,
          sobrenome: result.sobrenome || null,
          email: result.email,
          telefone: result.telefone || null,
          cpf: result.cpf,
          status: result.status || null,
          tipo_morador: result.tipo_morador || null,
          apartamento: result.apartamento || null,
          bloco: result.bloco || null,
          path_avatar: result.path_avatar || null,
          role: result.tipo,
          id_condominio: result.id_condominio,
          nome_condominio: result.nome_condominio || null,
          empresa: "condominio"
        },
        JWT_SECRET,
        { expiresIn: "1d" }
      );

      const nomeCompleto = `${result.nome || ""} ${result.sobrenome || ""}`.trim();

      return res.send({
        id: result.id,
        id_condominio: result.id_condominio,
        matricula: result.cpf,
        nome: nomeCompleto,
        email: result.email,
        telefone: result.telefone,
        token,
        msg: "",
        id_perfil: result.tipo_perfil_id || null,
        nome_perfil: result.nome_perfil || result.tipo || null,
        cpf: result.cpf,
        status: result.status,
        id_empresa: result.id_condominio,
        check: true,
        role: result.tipo,
        img: null,
        imgb: null,
        nome_empresa: result.nome_condominio || "Condomínio",
        last_online: result.last_login_at,
        theme: null,
        idioma: null,
        usuario: {
          id: result.id,
          nome: result.nome || null,
          sobrenome: result.sobrenome || null,
          nome_completo: nomeCompleto,
          cpf: result.cpf || null,
          email: result.email || null,
          telefone: result.telefone || null,
          status: result.status || null,
          tipo: result.tipo || null,
          tipo_morador: result.tipo_morador || null,
          apartamento: result.apartamento || null,
          bloco: result.bloco || null,
          path_avatar: result.path_avatar || null
        },
        perfil: {
          id: result.tipo_perfil_id || null,
          nome: result.nome_perfil || result.tipo || null
        },
        condominio: {
          id: result.id_condominio || null,
          nome: result.nome_condominio || null
        }
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
