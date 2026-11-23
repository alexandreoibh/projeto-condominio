"use strict";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { QueryTypes } = require("sequelize");
const postgres = require("../database/postgres");
const crypto = require("crypto");
const { ipEfetivo } = require("../helpers/ipCliente");
const { buildAvatarProxyUrl } = require("../helpers/avatarProxy");
const { getJwtSecret } = require("../helpers/segredos");
const { lerTokenVersion, incrementarTokenVersion } = require("../helpers/sessao");

// Hash bcrypt fixo usado só para equalizar o tempo de resposta quando o login
// não existe (evita enumeração de usuários por timing).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

// Rate limit persistente (serverless: memória não é compartilhada entre
// instâncias). Contado em tb_sgw_log_acesso.
const LOGIN_RATE_WINDOW_MINUTES = 15;
const LOGIN_MAX_FALHAS_POR_LOGIN = 10;
const LOGIN_MAX_FALHAS_POR_IP = 30;

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

    if (this._ehHashBcrypt(passwordHash)) {
      return bcrypt.compare(password, passwordHash);
    }

    // Legado: senha gravada em texto puro. Comparação em tempo constante; se
    // conferir, o login regrava como bcrypt (ver _migrarSenhaLegada).
    const a = crypto.createHash("sha256").update(String(password)).digest();
    const b = crypto.createHash("sha256").update(String(passwordHash)).digest();
    return crypto.timingSafeEqual(a, b);
  }

  _ehHashBcrypt(passwordHash) {
    const valor = String(passwordHash || "");
    return valor.startsWith("$2a$") || valor.startsWith("$2b$") || valor.startsWith("$2y$");
  }

  async _migrarSenhaLegada(idUsuario, password) {
    try {
      const novoHash = await bcrypt.hash(String(password), 10);
      await postgres.query(
        `UPDATE "condominio-bh"."tb-usuarios" SET senha_hash = :senha_hash WHERE id = :id`,
        { replacements: { id: idUsuario, senha_hash: novoHash }, type: QueryTypes.UPDATE }
      );
    } catch (error) {
      console.error("[login] Falha ao migrar senha legada para bcrypt:", error?.message);
    }
  }

  async _excedeuLimiteFalhas(req, login) {
    try {
      // Via proxy confiável (back-cond.php), o IP do cliente; null se o proxy
      // não informou (vale só o limite por login). Ver helpers/ipCliente.js.
      const { ip } = ipEfetivo(req);
      const rows = await postgres.query(
        `SELECT
            SUM(CASE WHEN lower(email_informado) = :login THEN 1 ELSE 0 END) AS falhas_login,
            SUM(CASE WHEN ip = :ip THEN 1 ELSE 0 END) AS falhas_ip
           FROM "condominio-bh".tb_sgw_log_acesso
          WHERE acao = 'LOGIN'
            AND sucesso = false
            AND data_evento > now() - CAST(:janela AS interval)
            AND (lower(email_informado) = :login OR ip = :ip)`,
        {
          replacements: {
            login: String(login || "").toLowerCase(),
            ip,
            janela: `${LOGIN_RATE_WINDOW_MINUTES} minutes`
          },
          type: QueryTypes.SELECT
        }
      );
      const row = rows && rows[0] ? rows[0] : {};
      const falhasLogin = Number.parseInt(row.falhas_login, 10) || 0;
      // Sem IP efetivo (proxy que não informou o cliente): só o limite por login.
      const falhasIp = ip ? Number.parseInt(row.falhas_ip, 10) || 0 : 0;
      return falhasLogin >= LOGIN_MAX_FALHAS_POR_LOGIN || falhasIp >= LOGIN_MAX_FALHAS_POR_IP;
    } catch (error) {
      // Falha ao consultar o limite não bloqueia o login.
      console.error("[login] Falha ao consultar rate limit:", error?.message);
      return false;
    }
  }

  // IP observado pelo servidor. Com app.set("trust proxy", 1), req.ip vem do
  // X-Forwarded-For gravado pelo proxy da Vercel. Nunca usar IP enviado pelo
  // cliente (body.ip, x-client-ip) para decisões de segurança.
  _resolveRequestIp(req) {
    const rawIp = req.ip || req.socket?.remoteAddress || null;

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
      const headers = req.headers && typeof req.headers === "object" ? req.headers : {};
      const userAgent = req.headers?.["user-agent"] ? String(req.headers["user-agent"]) : null;
      const ipHeader = this._resolveRequestIp(req);
      const { dispositivo: dispositivoInferido, sistemaOperacional: soInferido, navegador: navegadorInferido } =
        this._extractClientInfo(userAgent);

      const loginPayload = this._normalizarTextoOuNull(payload.login ?? payload.email, 255);
      const ipPayload = this._normalizarTextoOuNull(
        payload.ip ?? headers["x-client-ip"] ?? headers["x-ip"],
        64
      );
      const dispositivoPayload = this._normalizarTextoOuNull(
        payload.dispositivo ?? headers["x-client-device"] ?? headers["x-dispositivo"],
        120
      );
      const soPayload = this._normalizarTextoOuNull(
        payload.sistema_operacional ?? headers["x-client-os"] ?? headers["x-sistema-operacional"],
        120
      );
      const navegadorPayload = this._normalizarTextoOuNull(
        payload.navegador ?? headers["x-client-browser"] ?? headers["x-navegador"],
        120
      );
      const localizacaoPayload = this._normalizarTextoOuNull(
        payload.localizacao_aproximada ?? headers["x-client-location"] ?? headers["x-localizacao-aproximada"],
        255
      );

      // Coluna ip: o IP observado; via proxy confiável (back-cond.php), o IP do
      // cliente que ele informou. Um IP declarado por cliente direto só vai na
      // mensagem, como ip_informado.
      const { ip: ipCliente, viaProxy } = ipEfetivo(req);
      const ip = viaProxy ? ipCliente || ipHeader || null : ipHeader || null;
      let mensagemFinal = mensagem;
      if (viaProxy) {
        mensagemFinal = `${mensagem || ""} [via_proxy=${viaProxy}]`.trim().slice(0, 1000);
      } else if (ipPayload && ipPayload !== ipHeader) {
        mensagemFinal = `${mensagem || ""} [ip_informado=${ipPayload}]`.trim().slice(0, 1000);
      }
      const dispositivo = dispositivoPayload || dispositivoInferido;
      const sistemaOperacional = soPayload || soInferido;
      const navegador = navegadorPayload || navegadorInferido;
      const emailNormalizado = this._normalizarTextoOuNull(emailInformado, 255);
      const emailParaLog = emailNormalizado || loginPayload;

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
            email_informado: emailParaLog,
            acao,
            sucesso: Boolean(sucesso),
            ip,
            user_agent: userAgent,
            dispositivo,
            sistema_operacional: sistemaOperacional,
            navegador,
            localizacao_aproximada: localizacaoPayload,
            mensagem: mensagemFinal
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

      // Revoga este e os demais tokens de sessão do usuário.
      if (idUsuario) {
        await incrementarTokenVersion(idUsuario);
      }

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

      if (await this._excedeuLimiteFalhas(req, login)) {
        await this._registrarLogAcesso(req, {
          idUsuario: null,
          idCondominio: null,
          emailInformado: login,
          sucesso: false,
          mensagem: "Bloqueado por excesso de tentativas."
        });
        return res.status(429).send({
          check: false,
          message: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente."
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
            tu.updated_at,
            tcu.baixar_boleto AS unidade_baixar_boleto,
            tcu.id AS id_unidade
           FROM "condominio-bh"."tb-usuarios" tu
           LEFT JOIN "condominio-bh".tb_sgw_perfil p
               ON p.id::text = tu.tipo_perfil_id::text
           LEFT JOIN "condominio-bh"."tb-condominios" c
               ON c.id::text = tu.id_condominio::text
           LEFT JOIN "condominio-bh".tb_condominios_unidades tcu
               ON tcu.id_condominio = tu.id_condominio
              AND tcu.unidades_bloco = tu.apartamento
              AND tcu.bloco = NULLIF(tu.bloco, '')::int
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
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        await this._registrarLogAcesso(req, {
          idUsuario: null,
          idCondominio: null,
          emailInformado: login,
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

      if (!this._ehHashBcrypt(result.senha_hash)) {
        await this._migrarSenhaLegada(result.id, password);
      }

      const tokenVersion = await lerTokenVersion(result.id);

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
          id_unidade: result.id_unidade || null,
          nome_condominio: result.nome_condominio || null,
          empresa: "condominio",
          tv: tokenVersion
        },
        getJwtSecret(),
        { expiresIn: "1d", algorithm: "HS256" }
      );

      const nomeCompleto = `${result.nome || ""} ${result.sobrenome || ""}`.trim();
      const avatarUrl = buildAvatarProxyUrl(req, result.id, result.path_avatar);

      return res.send({
        id: result.id,
        id_condominio: result.id_condominio,
        id_unidade: result.id_unidade || null,
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
        avatar_url: avatarUrl,
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
          id_unidade: result.id_unidade || null,
          path_avatar: result.path_avatar || null,
          avatar_url: avatarUrl,
          // Boleto digital da UNIDADE (tb_condominios_unidades); null = unidade
          // ainda não respondeu (ou usuário sem unidade).
          unidade_baixar_boleto:
            result.unidade_baixar_boleto === null || result.unidade_baixar_boleto === undefined
              ? null
              : Boolean(result.unidade_baixar_boleto)
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
