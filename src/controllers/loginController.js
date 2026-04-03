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

  _resolveRequestIp(req) {
    const forwarded = req.headers?.["x-forwarded-for"];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const forwardedIp = forwardedValue ? String(forwardedValue).split(",")[0].trim() : null;
    const rawIp = forwardedIp || req.ip || req.socket?.remoteAddress || null;

    if (!rawIp) {
      return null;
    }

    return String(rawIp).replace(/^::ffff:/, "");
  }

  _extractClientInfo(userAgentRaw) {
    const userAgent = String(userAgentRaw || "");
    const userAgentLower = userAgent.toLowerCase();

    let dispositivo = "desktop";
    if (/mobile|iphone|ipod|android/.test(userAgentLower)) {
      dispositivo = "mobile";
    } else if (/ipad|tablet/.test(userAgentLower)) {
      dispositivo = "tablet";
    }

    let sistemaOperacional = "desconhecido";
    if (/windows nt/i.test(userAgent)) {
      sistemaOperacional = "Windows";
    } else if (/android/i.test(userAgent)) {
      sistemaOperacional = "Android";
    } else if (/iphone|ipad|ipod|ios/i.test(userAgent)) {
      sistemaOperacional = "iOS";
    } else if (/mac os x|macintosh/i.test(userAgent)) {
      sistemaOperacional = "macOS";
    } else if (/linux/i.test(userAgent)) {
      sistemaOperacional = "Linux";
    }

    let navegador = "desconhecido";
    if (/edg\//i.test(userAgent)) {
      navegador = "Edge";
    } else if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) {
      navegador = "Opera";
    } else if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent)) {
      navegador = "Chrome";
    } else if (/firefox\//i.test(userAgent)) {
      navegador = "Firefox";
    } else if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) {
      navegador = "Safari";
    }

    return {
      dispositivo,
      sistemaOperacional,
      navegador
    };
  }

  _normalizarTextoOuNull(value, maxLength = null) {
    if (value === undefined || value === null) {
      return null;
    }

    const text = String(value).trim();
    if (text === "") {
      return null;
    }

    if (maxLength && Number.isInteger(maxLength) && maxLength > 0) {
      return text.slice(0, maxLength);
    }

    return text;
  }

  async _registrarLogAcesso(req, {
    idUsuario = null,
    idCondominio = null,
    emailInformado = null,
    acao = "LOGIN",
    sucesso = false,
    mensagem = null
  } = {}) {
    try {
      const payload = req.body && typeof req.body === "object" ? req.body : {};
      const userAgent = req.headers?.["user-agent"] ? String(req.headers["user-agent"]) : null;
      const ipHeader = this._resolveRequestIp(req);
      const { dispositivo: dispositivoInferido, sistemaOperacional: soInferido, navegador: navegadorInferido } =
        this._extractClientInfo(userAgent);

      const loginPayload = this._normalizarTextoOuNull(payload.login ?? payload.email, 255);
      const ipPayload = this._normalizarTextoOuNull(payload.ip, 64);
      const dispositivoPayload = this._normalizarTextoOuNull(payload.dispositivo, 120);
      const soPayload = this._normalizarTextoOuNull(payload.sistema_operacional, 120);
      const navegadorPayload = this._normalizarTextoOuNull(payload.navegador, 120);
      const localizacaoPayload = this._normalizarTextoOuNull(payload.localizacao_aproximada, 255);

      const ip = ipPayload || ipHeader;
      const dispositivo = dispositivoPayload || dispositivoInferido;
      const sistemaOperacional = soPayload || soInferido;
      const navegador = navegadorPayload || navegadorInferido;
      const emailNormalizado = this._normalizarTextoOuNull(emailInformado, 255);

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_sgw_log_acesso (
            id_usuario,
          id_condominio,
            email_informado,
            acao,
            sucesso,
            ip,
            user_agent,
            dispositivo,
            sistema_operacional,
            navegador,
            localizacao_aproximada,
            mensagem,
            data_evento
          ) VALUES (
            :id_usuario,
            :id_condominio,
            :email_informado,
            :acao,
            :sucesso,
            :ip,
            :user_agent,
            :dispositivo,
            :sistema_operacional,
            :navegador,
            :localizacao_aproximada,
            :mensagem,
            now()
          )`,
        {
          replacements: {
            id_usuario: idUsuario,
            id_condominio: idCondominio,
            email_informado: emailNormalizado || loginPayload,
            acao,
            sucesso: Boolean(sucesso),
            ip,
            user_agent: userAgent,
            dispositivo,
            sistema_operacional: sistemaOperacional,
            navegador,
            localizacao_aproximada: localizacaoPayload,
            mensagem
          },
          type: QueryTypes.INSERT
        }
      );
    } catch (logError) {
      // O log de acesso não deve impedir o fluxo de autenticação.
    }
  }

  async login(req, res) {
    return this.index(req, res);
  }

  async logout(req, res) {
    try {
      const idUsuario = Number.parseInt(req.idcliente, 10) || null;
      const idCondominio = Number.parseInt(req.id_condominio, 10) || null;
      const emailInformado = req.emailUsuario ? String(req.emailUsuario).toLowerCase() : null;

      await this._registrarLogAcesso(req, {
        idUsuario,
        idCondominio,
        emailInformado,
        acao: "LOGOUT",
        sucesso: true,
        mensagem: "Logout realizado com sucesso."
      });

      return res.status(200).send({
        check: true,
        message: "Logout registrado com sucesso."
      });
    } catch (error) {
      await this._registrarLogAcesso(req, {
        idUsuario: Number.parseInt(req.idcliente, 10) || null,
        idCondominio: Number.parseInt(req.id_condominio, 10) || null,
        emailInformado: req.emailUsuario ? String(req.emailUsuario).toLowerCase() : null,
        acao: "LOGOUT",
        sucesso: false,
        mensagem: `Erro interno no logout: ${error.message}`
      });

      return res.status(500).send({
        check: false,
        message: "Erro no logout.",
        detail: error.message
      });
    }
  }

  async index(req, res) {
    try {
      const { login, password } = this._extractCredentials(req);
      const cpf = this._normalizeCpf(login);
      const emailInformado = login && login.includes("@") ? login : null;

      if (!login || !password) {
        await this._registrarLogAcesso(req, {
          idUsuario: null,
          idCondominio: null,
          emailInformado,
          sucesso: false,
          mensagem: "Login e/ou senha não informados."
        });

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
        await this._registrarLogAcesso(req, {
          idUsuario: null,
          idCondominio: null,
          emailInformado,
          sucesso: false,
          mensagem: "Usuário não encontrado ou inativo."
        });

        return res.send({
          check: false,
          message: "Usuário ou senha inválidos."
        });
      }

      const passwordOk = await this._isPasswordValid(password, result.senha_hash);

      if (!passwordOk) {
        await this._registrarLogAcesso(req, {
          idUsuario: result.id,
          idCondominio: Number.parseInt(result.id_condominio, 10) || null,
          emailInformado: result.email || emailInformado,
          sucesso: false,
          mensagem: "Senha inválida."
        });

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

      await this._registrarLogAcesso(req, {
        idUsuario: result.id,
        idCondominio: Number.parseInt(result.id_condominio, 10) || null,
        emailInformado: result.email || emailInformado,
        sucesso: true,
        mensagem: "Login realizado com sucesso."
      });

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
      await this._registrarLogAcesso(req, {
        idUsuario: null,
        idCondominio: Number.parseInt(req.id_condominio, 10) || null,
        emailInformado: this._extractCredentials(req).login || null,
        sucesso: false,
        mensagem: `Erro interno no login: ${error.message}`
      });

      return res.status(500).send({
        check: false,
        message: "Erro no login.",
        detail: error.message
      });
    }
  }
}

module.exports = Login;
