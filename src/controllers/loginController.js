"use strict";

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { QueryTypes } = require("sequelize");
const postgres = require("../database/postgres");
const crypto = require("crypto");
const { ipEfetivo, ipObservado } = require("../helpers/ipCliente");
const { buildAvatarProxyUrl } = require("../helpers/avatarProxy");
const { getJwtSecret } = require("../helpers/segredos");
const { lerTokenVersion, incrementarTokenVersion } = require("../helpers/sessao");
const { valorParaLog, idRequisicao } = require("../helpers/logSeguro");
const rateLimit = require("../helpers/rateLimit");

// Login gravado em tb_sgw_log_acesso só se tiver formato de e-mail/CPF/usuário;
// fora disso vai um fingerprint (ver helpers/logSeguro.js).
const CHARSET_LOGIN_LOG = /^[A-Za-z0-9._%+\-@]{1,255}$/;

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

  // Só bcrypt. Incidente 22/11/2026: a senha legada em texto puro deixou de
  // ser aceita — qualquer valor não-bcrypt em senha_hash (ex.: 'RESET' ou um
  // marcador de "trocar senha") viraria uma senha válida. Usuários com senha
  // legada (ou NULL/vazia) entram pelo "Esqueci minha senha".
  async _isPasswordValid(password, passwordHash) {
    if (!this._ehHashBcrypt(passwordHash)) {
      await bcrypt.compare(String(password || ""), DUMMY_BCRYPT_HASH);
      return false;
    }
    return bcrypt.compare(String(password), passwordHash);
  }

  _ehHashBcrypt(passwordHash) {
    return /^\$2[aby]\$\d{2}\$/.test(String(passwordHash || ""));
  }

  // Rate limit persistente, contado em tb_sgw_log_acesso. A identidade é
  // normalizada: com o usuário resolvido, conta as falhas pelo id_usuario
  // (e-mail e CPF do mesmo usuário somam juntos — antes, tentar pelo CPF
  // não contava nas falhas gravadas com o e-mail). Retorna
  // { bloqueado, erro }: se a consulta falhar, o login é recusado (fail closed).
  async _excedeuLimiteFalhas(req, login, idUsuario = null) {
    try {
      const { ip } = ipEfetivo(req);
      const idRef = Number.isInteger(idUsuario) ? idUsuario : 0;
      const rows = await postgres.query(
        `SELECT
            SUM(CASE WHEN (:id_usuario > 0 AND id_usuario = :id_usuario)
                       OR lower(email_informado) = :login THEN 1 ELSE 0 END) AS falhas_login,
            SUM(CASE WHEN ip = :ip THEN 1 ELSE 0 END) AS falhas_ip
           FROM "condominio-bh".tb_sgw_log_acesso
          WHERE acao = 'LOGIN'
            AND sucesso = false
            AND data_evento > now() - CAST(:janela AS interval)
            AND ((:id_usuario > 0 AND id_usuario = :id_usuario)
                 OR lower(email_informado) = :login OR ip = :ip)`,
        {
          replacements: {
            // Mesmo identificador gravado no log (fingerprint para login malformado).
            login: String(this._identificadorLoginLog(login) || "").toLowerCase(),
            id_usuario: idRef,
            ip,
            janela: `${LOGIN_RATE_WINDOW_MINUTES} minutes`
          },
          type: QueryTypes.SELECT
        }
      );
      const row = rows && rows[0] ? rows[0] : {};
      const falhasLogin = Number.parseInt(row.falhas_login, 10) || 0;
      let falhasIp = ip ? Number.parseInt(row.falhas_ip, 10) || 0 : 0;
      // Sem IP efetivo (proxy confiável que não informou o cliente): todas essas
      // requisições dividem um balde persistente (tb_rate_limit), por tentativa,
      // chaveado pelo IP do proxy observado — nunca por header do cliente.
      if (!ip) {
        const reserva = await rateLimit.consumir(
          `login-${this._chaveLimiteIp(req)}`,
          LOGIN_MAX_FALHAS_POR_IP,
          LOGIN_RATE_WINDOW_MINUTES * 60
        );
        if (!reserva.permitido) falhasIp = LOGIN_MAX_FALHAS_POR_IP;
      }
      return { bloqueado: falhasLogin >= LOGIN_MAX_FALHAS_POR_LOGIN || falhasIp >= LOGIN_MAX_FALHAS_POR_IP, erro: false };
    } catch (error) {
      console.error("[login] Falha ao consultar rate limit (login recusado):", error?.message);
      return { bloqueado: true, erro: true };
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

  // Chave de limite por origem: IP efetivo; sem ele (proxy confiável que não
  // informou o cliente), um balde único por proxy observado. Header enviado
  // pelo cliente nunca entra na chave.
  _chaveLimiteIp(req) {
    const { ip } = ipEfetivo(req);
    if (ip) return `ip:${String(ip).slice(0, 64)}`;
    const proxy = ipObservado(req);
    return `proxy-sem-ip:${String(proxy || "desconhecido").slice(0, 64)}`;
  }

  // Durante ataque, falhas já bloqueadas ou entradas inválidas só são gravadas
  // até o limite por origem da janela. Contador persistente (tb_rate_limit),
  // compartilhado entre instâncias; indisponível → não grava.
  async _podeGravarFalha(req, tipo = "bloqueado") {
    try {
      const reserva = await rateLimit.consumir(
        `log-login-${tipo}:${this._chaveLimiteIp(req)}`,
        LOGIN_MAX_FALHAS_POR_IP,
        LOGIN_RATE_WINDOW_MINUTES * 60
      );
      return reserva.permitido;
    } catch (erro) {
      return false;
    }
  }

  // Validação do /api/login falhou (422): a tentativa conta no rate limit
  // (vira uma falha de LOGIN no log, com fingerprint) e IP já bloqueado
  // recebe 429. Nunca chega à consulta de autenticação.
  async registrarEntradaInvalida(req) {
    const login = typeof req.body?.login === "string" ? req.body.login.trim().toLowerCase() : req.body?.login;
    const limite = await this._excedeuLimiteFalhas(req, typeof login === "string" ? login : JSON.stringify(login ?? null));
    if (await this._podeGravarFalha(req, "invalido")) {
      await this._registrarLogAcesso(req, {
        emailInformado: typeof login === "string" ? login : null,
        sucesso: false,
        mensagem: "Entrada inválida no login."
      });
    }
    return limite;
  }

  _identificadorLoginLog(login) {
    return valorParaLog(login, 255, CHARSET_LOGIN_LOG).valor;
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
      // Todo valor vindo do cliente passa por valorParaLog: fora do charset
      // seguro, grava fingerprint + categoria (nunca o payload).
      const suspeitas = new Set();
      const seguro = (valor, max, charset) => {
        const r = valorParaLog(valor, max, charset);
        if (r.suspeito) suspeitas.add(r.suspeito);
        return r.valor;
      };
      const userAgentBruto = req.headers?.["user-agent"] ? String(req.headers["user-agent"]) : null;
      const userAgent = seguro(userAgentBruto, 255);
      const ipHeader = this._resolveRequestIp(req);
      const { dispositivo: dispositivoInferido, sistemaOperacional: soInferido, navegador: navegadorInferido } =
        this._extractClientInfo(userAgentBruto);

      const loginPayload = seguro(payload.login ?? payload.email, 255, CHARSET_LOGIN_LOG);
      const ipPayload = seguro(payload.ip ?? headers["x-client-ip"] ?? headers["x-ip"], 64);
      const dispositivoPayload = seguro(payload.dispositivo ?? headers["x-client-device"] ?? headers["x-dispositivo"], 120);
      const soPayload = seguro(payload.sistema_operacional ?? headers["x-client-os"] ?? headers["x-sistema-operacional"], 120);
      const navegadorPayload = seguro(payload.navegador ?? headers["x-client-browser"] ?? headers["x-navegador"], 120);
      const localizacaoPayload = seguro(
        payload.localizacao_aproximada ?? headers["x-client-location"] ?? headers["x-localizacao-aproximada"],
        255
      );

      // Coluna ip: o IP observado; via proxy confiável (back-cond.php), o IP do
      // cliente que ele informou. Um IP declarado por cliente direto só vai na
      // mensagem, como ip_informado.
      const { ip: ipCliente, viaProxy } = ipEfetivo(req);
      const ip = seguro(viaProxy ? ipCliente || ipHeader || null : ipHeader || null, 64);
      let mensagemFinal = mensagem;
      if (viaProxy) {
        mensagemFinal = `${mensagem || ""} [via_proxy=${viaProxy}]`.trim().slice(0, 1000);
      } else if (ipPayload && ipPayload !== ipHeader) {
        mensagemFinal = `${mensagem || ""} [ip_informado=${ipPayload}]`.trim().slice(0, 1000);
      }
      // Dispositivo/SO/navegador/localização declarados só valem vindos do
      // proxy confiável (back-cond.php). De cliente direto, são inferidos do
      // User-Agent; o valor declarado vai só para a mensagem (ex.: "x").
      const dispositivo = (viaProxy && dispositivoPayload) || seguro(dispositivoInferido, 120);
      const sistemaOperacional = (viaProxy && soPayload) || seguro(soInferido, 120);
      const navegador = (viaProxy && navegadorPayload) || seguro(navegadorInferido, 120);
      if (!viaProxy && (dispositivoPayload || soPayload || navegadorPayload || localizacaoPayload)) {
        const declarado = [dispositivoPayload, soPayload, navegadorPayload].map((v) => v || "-").join("/");
        mensagemFinal = `${mensagemFinal || ""} [cliente_declarado=${declarado}]`.trim().slice(0, 1000);
      }
      const emailNormalizado = seguro(emailInformado, 255, CHARSET_LOGIN_LOG);
      const emailParaLog = emailNormalizado || loginPayload;
      const rota = String(req.originalUrl || req.url || "").split("?")[0].replace(/[^A-Za-z0-9/._-]/g, "").slice(0, 80);
      const marcadores = [`[rota=${rota}]`, `[req=${idRequisicao(req)}]`];
      if (suspeitas.size > 0) marcadores.push(`[suspeito=${[...suspeitas].join(",")}]`);
      mensagemFinal = `${mensagemFinal || ""} ${marcadores.join(" ")}`.trim().slice(0, 1000);

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
            localizacao_aproximada: viaProxy ? localizacaoPayload : null,
            mensagem: mensagemFinal
          },
          type: QueryTypes.INSERT
        }
      );
    } catch (logError) {
      // O log de acesso não impede a autenticação, mas a falha fica visível.
      console.error(`[login] Falha ao gravar log de acesso (${acao}):`, logError?.message);
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
          WHERE (lower(tu.email) = :loginEmail OR (:loginCpf <> '' AND tu.cpf = :loginCpf))
            AND tu.status in ('ativo','Ativo')
          ORDER BY tu.id
          LIMIT 1`,
        {
          replacements: {
            loginEmail: login,
            // Só um CPF completo identifica: e-mail sem dígitos não pode casar
            // usuários com cpf vazio.
            loginCpf: cpf.length === 11 ? cpf : ''
          },
          type: QueryTypes.SELECT
        }
      );

      const result = user && user.length > 0 ? user[0] : null;

      const limite = await this._excedeuLimiteFalhas(req, login, result ? Number.parseInt(result.id, 10) : null);
      if (limite.bloqueado) {
        if (limite.erro || (await this._podeGravarFalha(req, "bloqueado"))) {
          await this._registrarLogAcesso(req, {
            idUsuario: result ? result.id : null,
            idCondominio: result ? Number.parseInt(result.id_condominio, 10) || null : null,
            emailInformado: login,
            sucesso: false,
            mensagem: limite.erro ? "Rate limit indisponível; login recusado." : "Bloqueado por excesso de tentativas."
          });
        }
        if (limite.erro) {
          return res.status(503).send({
            check: false,
            message: "Não foi possível validar o login agora. Tente novamente em instantes."
          });
        }
        return res.status(429).send({
          check: false,
          message: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente."
        });
      }

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
