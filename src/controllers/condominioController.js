const postgres = require('../database/postgres');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { put } = require('@vercel/blob');
const fetch = require('node-fetch');
const { QueryTypes } = require('sequelize');
const pushNotificationService = require('../service/pushNotificationService');
const { despacharEmail, despacharEmailReserva } = require('../service/emailDispatchService');
const { waitUntil } = require('@vercel/functions');
const { buildAvatarProxyUrl, buildConsumoImagemProxyUrl, buildDashboardImagemProxyUrl, getBlobReadToken, resolveBlobUrl } = require('../helpers/avatarProxy');

const INVITE_TOKEN_SECRET =
  process.env.SERVICE_INVITE_TOKEN_SECRET ||
  process.env.INVITE_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  'dev_invite_secret_change_me';
const PUBLIC_REGISTER_RATE_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_REGISTER_RATE_MAX_ATTEMPTS = 5;
const INVITE_TOKEN_USAGE_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_TOKEN_MAX_USES = 100;

const publicRegistrationAttempts = new Map();
const usedInviteTokens = new Map();
const recoveryOtpStore = new Map(); // key: email, value: { code, expiresAt }
const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutos

class CondominioController {
  _toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  _parseDataAgendamento(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
      return null;
    }

    const raw = String(value).trim();

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [dia, mes, ano] = raw.split('/').map((item) => Number(item));
      const dataUtc = new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0));

      if (
        dataUtc.getUTCFullYear() === ano &&
        dataUtc.getUTCMonth() === mes - 1 &&
        dataUtc.getUTCDate() === dia
      ) {
        return dataUtc;
      }

      return null;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  _resolveRequestIp(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const forwardedIp = forwardedValue ? String(forwardedValue).split(',')[0].trim() : null;
    const rawIp = forwardedIp || req.ip || req.socket?.remoteAddress || null;

    if (!rawIp) {
      return null;
    }

    return String(rawIp).replace(/^::ffff:/, '');
  }

  _normalizarPerfil(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  async _uploadImagemBlob(arquivo, idCondominio, subPath, origemImagemAtual = null) {
    const { put } = require('@vercel/blob');
    const path = require('path');

    const extByOriginalName = path.extname(String(arquivo.originalname || '')).replace('.', '').toLowerCase();
    const extByMime = String(arquivo.mimetype || '').split('/').pop().split(';')[0].trim().toLowerCase();
    const extensao = extByOriginalName || extByMime || 'jpg';

    const ambiente =
      this._normalizarTextoOuNull(
        process.env.BLOB_UPLOAD_ENV || process.env.BLOB_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV
      ) || 'dev';

    const versaoAtualMatch = origemImagemAtual
      ? String(origemImagemAtual).match(/\/imagem\/v(\d+)\.[^\/?#]+(?:[?#].*)?$/i)
      : null;
    const versaoAtualNumero = versaoAtualMatch ? this._toInt(versaoAtualMatch[1], 0) : 0;
    const versao = `v${(Number.isFinite(versaoAtualNumero) ? versaoAtualNumero : 0) + 1}`;

    const blobPath = `${ambiente}/condominios/${idCondominio}/${subPath}/imagem/${versao}.${extensao}`;

    const tokenSources = [
      { name: 'BLOB_PRIVATE_READ_WRITE_TOKEN', value: this._normalizarTextoOuNull(process.env.BLOB_PRIVATE_READ_WRITE_TOKEN) },
      { name: 'EMORADOR_READ_WRITE_TOKEN', value: this._normalizarTextoOuNull(process.env.EMORADOR_READ_WRITE_TOKEN) },
      { name: 'BLOB_READ_WRITE_TOKEN', value: this._normalizarTextoOuNull(process.env.BLOB_READ_WRITE_TOKEN) },
      { name: 'VERCEL_BLOB_READ_WRITE_TOKEN', value: this._normalizarTextoOuNull(process.env.VERCEL_BLOB_READ_WRITE_TOKEN) }
    ];

    const token = tokenSources.find((t) => t.value)?.value || null;
    if (!token) {
      throw new Error('Token do Vercel Blob não configurado. Defina BLOB_PRIVATE_READ_WRITE_TOKEN.');
    }

    const uploadResult = await put(blobPath, arquivo.buffer, {
      access: 'private',
      addRandomSuffix: false,
      contentType: arquivo.mimetype || undefined,
      token
    });

    return uploadResult?.url || uploadResult?.pathname || blobPath;
  }

  _cleanupPublicRegistrationAttempts(now = Date.now()) {
    for (const [key, bucket] of publicRegistrationAttempts.entries()) {
      if (!bucket || now - bucket.windowStart > PUBLIC_REGISTER_RATE_WINDOW_MS) {
        publicRegistrationAttempts.delete(key);
      }
    }
  }

  _consumePublicRegistrationAttempt(ip, email) {
    const now = Date.now();
    this._cleanupPublicRegistrationAttempts(now);

    const key = `${ip || 'ip-desconhecido'}|${email || 'sem-email'}`;
    const existing = publicRegistrationAttempts.get(key);

    if (!existing) {
      publicRegistrationAttempts.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (now - existing.windowStart > PUBLIC_REGISTER_RATE_WINDOW_MS) {
      publicRegistrationAttempts.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (existing.count >= PUBLIC_REGISTER_RATE_MAX_ATTEMPTS) {
      const retryAfterMs = PUBLIC_REGISTER_RATE_WINDOW_MS - (now - existing.windowStart);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 1)
      };
    }

    existing.count += 1;
    publicRegistrationAttempts.set(key, existing);
    return { allowed: true };
  }

  _cleanupUsedInviteTokens(now = Date.now()) {
    for (const [key, usageInfo] of usedInviteTokens.entries()) {
      const expiresAt =
        usageInfo && typeof usageInfo === 'object'
          ? usageInfo.expiresAt
          : usageInfo;

      if (!expiresAt || now >= expiresAt) {
        usedInviteTokens.delete(key);
      }
    }
  }

  _markInviteTokenAsUsed(key, ttlMs = INVITE_TOKEN_USAGE_TTL_MS) {
    const expiresAt = Date.now() + ttlMs;
    const usageInfo = usedInviteTokens.get(key);
    const countAtual =
      usageInfo && typeof usageInfo === 'object'
        ? this._toInt(usageInfo.count, 0)
        : usageInfo
          ? 1
          : 0;

    usedInviteTokens.set(key, {
      count: Math.max(countAtual, 0) + 1,
      expiresAt
    });
  }

  _isInviteTokenAlreadyUsed(key) {
    this._cleanupUsedInviteTokens();
    const usageInfo = usedInviteTokens.get(key);
    if (!usageInfo) {
      return false;
    }

    const count =
      usageInfo && typeof usageInfo === 'object'
        ? this._toInt(usageInfo.count, 0)
        : 1;

    return count >= INVITE_TOKEN_MAX_USES;
  }

  _getInviteTokenUsageCount(key) {
    this._cleanupUsedInviteTokens();
    const usageInfo = usedInviteTokens.get(key);
    if (!usageInfo) {
      return 0;
    }

    if (usageInfo && typeof usageInfo === 'object') {
      return this._toInt(usageInfo.count, 0);
    }

    return 1;
  }

  _normalizarTextoOuNull(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const text = String(value).trim();
    return text === '' ? null : text;
  }

  _anexarAvatarUrlUsuario(req, usuario) {
    if (!usuario || typeof usuario !== 'object') {
      return usuario;
    }

    if (!Object.prototype.hasOwnProperty.call(usuario, 'path_avatar')) {
      return usuario;
    }

    return {
      ...usuario,
      avatar_url: buildAvatarProxyUrl(req, usuario.id, usuario.path_avatar)
    };
  }

  _anexarAvatarUrlUsuarios(req, usuarios) {
    if (!Array.isArray(usuarios)) {
      return usuarios;
    }

    return usuarios.map((usuario) => this._anexarAvatarUrlUsuario(req, usuario));
  }

  _getIdTipoConsumoQuery(query = {}) {
    return this._toInt(
      query.id_tipo_consumo ?? query.id_tipo ?? query.idTipoConsumo ?? query.idTipo,
      null
    );
  }

  _getStatusConsumoPayload(payload = {}) {
    return this._normalizarTextoOuNull(
      payload.status ??
      payload.status_consumo ??
      payload.statusConsumo ??
      payload.consumo_status ??
      payload.consumoStatus ??
      payload.situacao
    );
  }

  _normalizarEmailOuNull(value) {
    const text = this._normalizarTextoOuNull(value);
    return text ? text.toLowerCase() : null;
  }

  _normalizarNomeCapitalizado(value) {
    const text = this._normalizarTextoOuNull(value);
    if (!text) {
      return null;
    }

    return text
      .split(/\s+/)
      .filter((item) => item)
      .map((parte) => {
        const lower = parte.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }

  _decodeBase64UrlJson(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    const base64 = padding ? `${normalized}${'='.repeat(4 - padding)}` : normalized;
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json);
  }

  _timingSafeHexEqual(a, b) {
    const aBuffer = Buffer.from(String(a || ''), 'hex');
    const bBuffer = Buffer.from(String(b || ''), 'hex');

    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(aBuffer, bBuffer);
  }

  _verifyInviteToken(token) {
    try {
      return jwt.verify(token, INVITE_TOKEN_SECRET, { maxAge: '24h' });
    } catch (jwtError) {
      const parts = String(token || '').split('.');

      if (parts.length !== 2) {
        throw jwtError;
      }

      const [payloadPart, signaturePart] = parts;
      const payload = this._decodeBase64UrlJson(payloadPart);

      if (!payload || typeof payload !== 'object') {
        throw new Error('invite_token payload inválido.');
      }

      const expectedSignature = crypto
        .createHmac('sha256', INVITE_TOKEN_SECRET)
        .update(payloadPart)
        .digest('base64url');

      if (!this._timingSafeHexEqual(Buffer.from(signaturePart).toString('hex'), Buffer.from(expectedSignature).toString('hex'))) {
        throw new Error('invite_token assinatura inválida.');
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const issuedAt = this._toInt(payload.iat, null);
      const expiresAt = this._toInt(payload.exp, null);

      if (expiresAt && nowSeconds > expiresAt) {
        throw new Error('invite_token expirado.');
      }

      if (issuedAt && nowSeconds - issuedAt > 24 * 60 * 60) {
        throw new Error('invite_token expirado.');
      }

      return payload;
    }
  }

  _extractInviteTokenFromRequest(req) {
    return this._normalizarTextoOuNull(
      req.body?.invite_token ??
      req.body?.token ??
      req.query?.invite_token ??
      req.query?.token ??
      req.header?.('x-invite-token') ??
      req.header?.('invite-token')
    );
  }

  _resolveInviteAuthContext(req) {
    const inviteToken = this._extractInviteTokenFromRequest(req);
    if (!inviteToken) {
      return null;
    }

    const invitePayload = this._verifyInviteToken(inviteToken);
    const idCondominioInvite = this._toInt(
      invitePayload.id_condominio ?? invitePayload.condominio_id ?? invitePayload.idCondominio,
      null
    );

    return {
      invitePayload,
      idCondominioInvite
    };
  }

  async _podeVisualizarDadosMorador(req) {
    const perfilToken = this._normalizarPerfil(req.nomePerfil);
    if (perfilToken === 'admin' || perfilToken === 'sindico') {
      return true;
    }

    const idPerfilToken = this._toInt(req.IdPerfil, null);
    if ([1, 3, 5, 54].includes(idPerfilToken)) {
      return true;
    }

    const idUsuarioToken = this._toInt(req.idcliente, null);
    const idCondominioToken = this._toInt(req.id_condominio, null);
    if (!idUsuarioToken || !idCondominioToken) {
      return false;
    }

    const usuario = await postgres.query(
      `SELECT tipo, tipo_perfil_id
         FROM "condominio-bh"."tb-usuarios"
        WHERE id = :id
          AND id_condominio = :id_condominio
        LIMIT 1`,
      {
        replacements: {
          id: idUsuarioToken,
          id_condominio: idCondominioToken
        },
        type: QueryTypes.SELECT
      }
    );

    if (!usuario || usuario.length === 0) {
      return false;
    }

    const perfilDb = this._normalizarPerfil(usuario[0].tipo);
    if (perfilDb === 'admin' || perfilDb === 'sindico') {
      return true;
    }

    const idPerfilDb = this._toInt(usuario[0].tipo_perfil_id, null);
    return [1, 3, 5, 54].includes(idPerfilDb);
  }

  _podeGerenciarPermissoesMenu(req) {
    const perfilToken = this._normalizarPerfil(req.nomePerfil);
    if (perfilToken === 'admin') {
      return true;
    }

    const idPerfilToken = this._toInt(req.IdPerfil, null);
    return idPerfilToken === 1;
  }

  async _buscarCondominioComUnidades(idCondominio, transaction = null) {
    const rows = await postgres.query(
      `SELECT
          c.id,
          c.nome,
          c.cnpj,
          c.email,
          c.telefone,
          c.ativo,
          c.qtde_ap_andar,
          c.escrita_bloco,
          c.qtde_ap_bloco,
          c.qtde_blocos,
          c.modelo_fatura,
          c.created_at,
          c.updated_at
        FROM "condominio-bh"."tb-condominios" c
       WHERE c.id = :id
       LIMIT 1`,
      {
        replacements: { id: idCondominio },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const unidades = await postgres.query(
      `SELECT id, bloco, unidades_bloco AS unidade
         FROM "condominio-bh".tb_condominios_unidades
        WHERE id_condominio = :id_condominio
        ORDER BY bloco ASC, unidades_bloco ASC`,
      {
        replacements: { id_condominio: idCondominio },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    return { ...rows[0], unidades_bloco: unidades };
  }

  async _sincronizarUnidadesCondominio(idCondominio, unidadesBloco, qtdeBlocos, transaction) {
    const totalBlocos = Math.max(this._toInt(qtdeBlocos, 1) || 1, 1);
    const unidadesOrdenadas = [...unidadesBloco].sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
    );

    const existentes = await postgres.query(
      `SELECT id, bloco, unidades_bloco
         FROM "condominio-bh".tb_condominios_unidades
        WHERE id_condominio = :id_condominio`,
      {
        replacements: { id_condominio: idCondominio },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    const chaveExistente = (bloco, unidade) => `${bloco}::${unidade}`;
    const existentesPorChave = new Set(
      existentes.map((row) => chaveExistente(this._toInt(row.bloco, null), row.unidades_bloco))
    );

    for (let bloco = 1; bloco <= totalBlocos; bloco += 1) {
      for (const unidade of unidadesOrdenadas) {
        const chave = chaveExistente(bloco, unidade);
        if (existentesPorChave.has(chave)) continue;

        await postgres.query(
          `INSERT INTO "condominio-bh".tb_condominios_unidades (
              id_condominio,
              unidades_bloco,
              bloco,
              created_at
            ) VALUES (
              :id_condominio,
              :unidades_bloco,
              :bloco,
              now()
            )`,
          {
            replacements: {
              id_condominio: idCondominio,
              unidades_bloco: unidade,
              bloco
            },
            transaction
          }
        );
      }
    }
  }

  async _buscarLogsTratamentoReserva(idAgenda) {
    return postgres.query(
      `SELECT
          ltr.id,
          ltr.id_pedido,
          ltr.id_tratamento_status,
          st.descricao_status,
          ltr.tratamento_motivo_pendente,
          ltr.tratamento_taxa_paga,
          ltr.tratamento_observacao,
          ltr.id_usuario,
          tu.nome AS usuario_nome,
          ltr.created_at
        FROM "condominio-bh".tb_log_tratamento_reserva ltr
        INNER JOIN "condominio-bh".tb_status_tratamento st
           ON st.id = ltr.id_tratamento_status
        LEFT JOIN "condominio-bh"."tb-usuarios" tu
           ON tu.id = ltr.id_usuario
        WHERE ltr.id_pedido = :id_pedido
        ORDER BY ltr.created_at ASC, ltr.id ASC`,
      {
        replacements: {
          id_pedido: idAgenda
        },
        type: QueryTypes.SELECT
      }
    );
  }

  async status(req, res) {
    return res.status(200).json({
      module: 'condominio',
      status: 'ok'
    });
  }

  async listarFaturaPlanos(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar planos de fatura.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (idCondominioFiltro && !ehAdmin && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para consultar planos de outro condomínio.'
        });
      }

      const idCondominioRef = idCondominioFiltro || (ehAdmin ? null : idCondominioToken);
      const ativoParam = this._normalizarTextoOuNull(req.query.ativo);

      const whereParts = ['fp.ativo = true'];
      const replacements = {
        id_condominio_ref: idCondominioRef
      };

      const data = await postgres.query(
        `SELECT
            fp.id,
            fp.nome,
            fp.valor,
            fp.limite_usuarios,
            fp.limite_unidades,
            fp.possui_relatorios,
            fp.possui_financeiro,
            fp.possui_notificacoes,
            fp.possui_app,
            fp.suporte,
            fp.ativo,
            fp.criado_em,
            fp.descricao,
            fcp.id AS id_vinculo_condominio_plano,
            fcp.id_condominio AS id_condominio_vinculado,
            fcp.data_inicio AS vinculo_data_inicio,
            fcp.data_fim AS vinculo_data_fim,
            fcp.ativo AS vinculo_ativo,
            CASE
              WHEN fcp.id IS NOT NULL THEN true
              ELSE false
            END AS plano_vinculado_condominio
          FROM "condominio-bh".tb_fatura_planos fp
          LEFT JOIN "condominio-bh".tb_fatura_condominio_plano fcp
            ON fcp.id = (
              SELECT cp.id
              FROM "condominio-bh".tb_fatura_condominio_plano cp
              WHERE cp.id_plano = fp.id
                AND (:id_condominio_ref IS NULL OR cp.id_condominio = :id_condominio_ref)
              ORDER BY
                CASE WHEN cp.ativo = true THEN 0 ELSE 1 END,
                cp.data_inicio DESC,
                cp.id DESC
              LIMIT 1
            )
          WHERE ${whereParts.join(' AND ')}
          ORDER BY fp.ativo DESC, fp.valor ASC, fp.id ASC`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const planoAtualCondominio = idCondominioRef
        ? data.find((item) => Boolean(item.vinculo_ativo) === true && item.id_condominio_vinculado === idCondominioRef) || null
        : null;

      return res.status(200).json({
        total: data.length,
        filtros: {
          id_condominio: idCondominioRef,
          ativo: 'true'
        },
        plano_atual_condominio: planoAtualCondominio,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar planos de fatura.',
        detail: error.message
      });
    }
  }

  async listarFaturasPagamentos(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar faturas.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (idCondominioFiltro && !ehAdmin && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para consultar faturas de outro condomínio.'
        });
      }

      const idCondominioRef = idCondominioFiltro || (ehAdmin ? null : idCondominioToken);
      const idFaturaFiltro = this._toInt(req.query.id_fatura, null);
      const idPlanoFiltro = this._toInt(req.query.id_plano, null);
      const referenciaFiltro = this._normalizarTextoOuNull(req.query.referencia);
      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      const vencimentoInicio =
        this._normalizarTextoOuNull(req.query.data_vencimento_inicio) ||
        this._normalizarTextoOuNull(req.query.vencimento_inicio);
      const vencimentoFim =
        this._normalizarTextoOuNull(req.query.data_vencimento_fim) ||
        this._normalizarTextoOuNull(req.query.vencimento_fim);

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 500);
      const offset = (page - 1) * pageSize;

      const whereParts = ['1 = 1'];
      const replacements = {
        limit: pageSize,
        offset,
        id_condominio_ref: idCondominioRef
      };

      if (idCondominioRef) {
        whereParts.push('fm.id_condominio = :id_condominio_ref');
      }

      if (idFaturaFiltro) {
        whereParts.push('fm.id = :id_fatura');
        replacements.id_fatura = idFaturaFiltro;
      }

      if (idPlanoFiltro) {
        whereParts.push('fm.id_plano = :id_plano');
        replacements.id_plano = idPlanoFiltro;
      }

      if (referenciaFiltro) {
        whereParts.push('fm.referencia = :referencia');
        replacements.referencia = referenciaFiltro;
      }

      if (statusFiltro) {
        whereParts.push("upper(COALESCE(fm.status, '')) = :status_fatura");
        replacements.status_fatura = String(statusFiltro).toUpperCase();
      }

      if (vencimentoInicio) {
        whereParts.push('fm.data_vencimento >= :vencimento_inicio::date');
        replacements.vencimento_inicio = vencimentoInicio;
      }

      if (vencimentoFim) {
        whereParts.push('fm.data_vencimento <= :vencimento_fim::date');
        replacements.vencimento_fim = vencimentoFim;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(1)::int AS total
           FROM "condominio-bh".tb_fatura_mes fm
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            fm.id,
            fm.id_condominio,
            c.nome AS nome_condominio,
            fm.id_plano,
            fp2.nome AS nome_plano,
            fm.id_condominio_plano,
            fm.valor,
            fm.data_vencimento,
            fm.data_emissao,
            fm.status,
            fm.referencia,
            fm.criado_em,
            COALESCE(
              (
                SELECT SUM(pg.valor_pago)::numeric(10,2)
                  FROM "condominio-bh".tb_fatura_pagamento pg
                 WHERE pg.id_fatura = fm.id
              ),
              0
            ) AS valor_pago_total,
            CASE
              WHEN COALESCE(
                (
                  SELECT SUM(pg.valor_pago)
                    FROM "condominio-bh".tb_fatura_pagamento pg
                   WHERE pg.id_fatura = fm.id
                ),
                0
              ) >= fm.valor THEN true
              ELSE false
            END AS quitada
          FROM "condominio-bh".tb_fatura_mes fm
          LEFT JOIN "condominio-bh"."tb-condominios" c
            ON c.id = fm.id_condominio
          LEFT JOIN "condominio-bh".tb_fatura_planos fp2
            ON fp2.id = fm.id_plano
          WHERE ${whereClause}
          ORDER BY fm.data_vencimento DESC, fm.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const idsFatura = data
        .map((item) => this._toInt(item.id, null))
        .filter((id) => id !== null);

      let pagamentosRows = [];
      if (idsFatura.length > 0) {
        pagamentosRows = await postgres.query(
          `SELECT
              fp.id,
              fp.id_fatura,
              fp.valor_pago,
              fp.data_pagamento,
              fp.metodo_pagamento,
              fp.status,
              fp.transacao_gateway,
              fp.cod_pix
            FROM "condominio-bh".tb_fatura_pagamento fp
            WHERE fp.id_fatura IN (:ids_fatura)
            ORDER BY fp.data_pagamento DESC, fp.id DESC`,
          {
            replacements: {
              ids_fatura: idsFatura
            },
            type: QueryTypes.SELECT
          }
        );
      }

      const pagamentosPorFatura = new Map();
      for (const pagamento of pagamentosRows) {
        const idFatura = this._toInt(pagamento.id_fatura, null);
        if (!idFatura) {
          continue;
        }

        if (!pagamentosPorFatura.has(idFatura)) {
          pagamentosPorFatura.set(idFatura, []);
        }

        pagamentosPorFatura.get(idFatura).push(pagamento);
      }

      const dataComPagamentos = data.map((fatura) => {
        const idFatura = this._toInt(fatura.id, null);
        return {
          ...fatura,
          pagamentos: idFatura && pagamentosPorFatura.has(idFatura)
            ? pagamentosPorFatura.get(idFatura)
            : []
        };
      });

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        filtros: {
          id_condominio: idCondominioRef,
          id_fatura: idFaturaFiltro,
          id_plano: idPlanoFiltro,
          referencia: referenciaFiltro,
          status: statusFiltro,
          data_vencimento_inicio: vencimentoInicio,
          data_vencimento_fim: vencimentoFim
        },
        data: dataComPagamentos
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar faturas e pagamentos.',
        detail: error.message
      });
    }
  }

  async resumoFaturasPendentes(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar pendências de fatura.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (idCondominioFiltro && !ehAdmin && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para consultar pendências de outro condomínio.'
        });
      }

      const idCondominioRef = idCondominioFiltro || (ehAdmin ? null : idCondominioToken);
      const limiteItens = Math.min(Math.max(this._toInt(req.query.limit, 5), 1), 20);

      const whereParts = ["upper(COALESCE(fm.status, 'PENDENTE')) = 'PENDENTE'"];
      const replacements = {
        id_condominio_ref: idCondominioRef,
        limit: limiteItens
      };

      if (idCondominioRef) {
        whereParts.push('fm.id_condominio = :id_condominio_ref');
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(1)::int AS total
           FROM "condominio-bh".tb_fatura_mes fm
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            fm.id,
            fm.id_condominio,
            c.nome AS nome_condominio,
            fm.id_plano,
            fp.nome AS nome_plano,
            fm.valor,
            fm.data_vencimento,
            fm.referencia,
            fm.status,
            COALESCE(
              (
                SELECT SUM(pg.valor_pago)::numeric(10,2)
                  FROM "condominio-bh".tb_fatura_pagamento pg
                 WHERE pg.id_fatura = fm.id
              ),
              0
            ) AS valor_pago_total,
            (fm.valor - COALESCE((
              SELECT SUM(pg.valor_pago)
                FROM "condominio-bh".tb_fatura_pagamento pg
               WHERE pg.id_fatura = fm.id
            ), 0))::numeric(10,2) AS valor_em_aberto
          FROM "condominio-bh".tb_fatura_mes fm
          LEFT JOIN "condominio-bh"."tb-condominios" c
            ON c.id = fm.id_condominio
          LEFT JOIN "condominio-bh".tb_fatura_planos fp
            ON fp.id = fm.id_plano
          WHERE ${whereClause}
          ORDER BY fm.data_vencimento ASC, fm.id DESC
          LIMIT :limit`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const totalPendentes = totalRows[0]?.total || 0;

      return res.status(200).json({
        possui_pendencia: totalPendentes > 0,
        quantidade_pendencias: totalPendentes,
        filtros: {
          id_condominio: idCondominioRef,
          status: 'PENDENTE',
          limit: limiteItens
        },
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao carregar resumo de faturas pendentes.',
        detail: error.message
      });
    }
  }

  async atualizarFaturaPlanoCondominio(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para atualizar plano de fatura.'
        });
      }

      const idCondominioPayload = this._toInt(req.body.id_condominio, null);
      const idCondominioRef = idCondominioPayload || idCondominioToken;
      if (!idCondominioRef) {
        return res.status(400).json({
          message: 'Campo id_condominio é obrigatório.'
        });
      }

      if (!ehAdmin && idCondominioRef !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para atualizar plano de outro condomínio.'
        });
      }

      const idPlanoNovo = this._toInt(req.body.id_plano, null);
      if (!idPlanoNovo) {
        return res.status(400).json({
          message: 'Campo id_plano é obrigatório e deve ser numérico.'
        });
      }

      const dataInicioInput = this._normalizarTextoOuNull(req.body.data_inicio);
      const dataFimAnteriorInput = this._normalizarTextoOuNull(req.body.data_fim_anterior);
      const observacaoMudanca = this._normalizarTextoOuNull(req.body.observacao);

      const transaction = await postgres.transaction();

      try {
        const planoRows = await postgres.query(
          `SELECT id, nome, ativo
             FROM "condominio-bh".tb_fatura_planos
            WHERE id = :id_plano
            LIMIT 1`,
          {
            replacements: { id_plano: idPlanoNovo },
            type: QueryTypes.SELECT,
            transaction
          }
        );

        if (!planoRows || planoRows.length === 0) {
          await transaction.rollback();
          return res.status(404).json({
            message: 'Plano de fatura não encontrado.'
          });
        }

        const planoNovo = planoRows[0];
        if (planoNovo.ativo === false) {
          await transaction.rollback();
          return res.status(400).json({
            message: 'Não é permitido vincular um plano inativo.'
          });
        }

        const vinculoAtualRows = await postgres.query(
          `SELECT id, id_condominio, id_plano, data_inicio, data_fim, ativo
             FROM "condominio-bh".tb_fatura_condominio_plano
            WHERE id_condominio = :id_condominio
              AND ativo = true
            ORDER BY data_inicio DESC, id DESC
            LIMIT 1`,
          {
            replacements: {
              id_condominio: idCondominioRef
            },
            type: QueryTypes.SELECT,
            transaction
          }
        );

        const vinculoAtual = vinculoAtualRows && vinculoAtualRows.length > 0 ? vinculoAtualRows[0] : null;

        if (vinculoAtual && this._toInt(vinculoAtual.id_plano, null) === idPlanoNovo) {
          await transaction.rollback();
          return res.status(200).json({
            message: 'Condomínio já está vinculado ao plano informado.',
            data: {
              id_condominio: idCondominioRef,
              id_plano: idPlanoNovo,
              vinculo_atual: vinculoAtual
            }
          });
        }

        if (vinculoAtual) {
          await postgres.query(
            `UPDATE "condominio-bh".tb_fatura_condominio_plano
                SET ativo = false,
                    data_fim = COALESCE(:data_fim_anterior, CURRENT_DATE)
              WHERE id = :id`,
            {
              replacements: {
                id: vinculoAtual.id,
                data_fim_anterior: dataFimAnteriorInput
              },
              type: QueryTypes.UPDATE,
              transaction
            }
          );
        }

        const novoVinculoRows = await postgres.query(
          `INSERT INTO "condominio-bh".tb_fatura_condominio_plano (
              id_condominio,
              id_plano,
              data_inicio,
              data_fim,
              ativo
            ) VALUES (
              :id_condominio,
              :id_plano,
              COALESCE(:data_inicio, CURRENT_DATE),
              NULL,
              true
            )
            RETURNING id, id_condominio, id_plano, data_inicio, data_fim, ativo`,
          {
            replacements: {
              id_condominio: idCondominioRef,
              id_plano: idPlanoNovo,
              data_inicio: dataInicioInput
            },
            transaction
          }
        );

        const novoVinculo = novoVinculoRows[0][0];

        await postgres.query(
          `INSERT INTO "condominio-bh".tb_log_tratamento_reserva (
             id_pedido,
             id_tratamento_status,
             tratamento_motivo_pendente,
             tratamento_taxa_paga,
             tratamento_observacao,
             id_usuario,
             created_at
           ) VALUES (
             :id_pedido,
             :id_tratamento_status,
             :tratamento_motivo_pendente,
             :tratamento_taxa_paga,
             :tratamento_observacao,
             :id_usuario,
             now()
           )`,
          {
            replacements: {
              id_pedido: idCondominioRef,
              id_tratamento_status: idPlanoNovo,
              tratamento_motivo_pendente: 'MUDANCA_PLANO_FATURA',
              tratamento_taxa_paga: 0,
              tratamento_observacao: [
                `Alteracao de plano do condominio ${idCondominioRef}`,
                vinculoAtual ? `de plano ${vinculoAtual.id_plano}` : 'sem plano anterior',
                `para plano ${idPlanoNovo}`,
                observacaoMudanca ? `obs: ${observacaoMudanca}` : null
              ]
                .filter((parte) => parte)
                .join(' | '),
              id_usuario: idUsuarioToken
            },
            transaction
          }
        );

        await postgres.query(
          `INSERT INTO "condominio-bh".tb_faturas_log_plano (
             id_condominio,
             id_plano_anterior,
             id_plano_novo,
             id_condominio_plano,
             tipo_alteracao,
             motivo,
             usuario_responsavel,
             origem,
             criado_em
           ) VALUES (
             :id_condominio,
             :id_plano_anterior,
             :id_plano_novo,
             :id_condominio_plano,
             :tipo_alteracao,
             :motivo,
             :usuario_responsavel,
             :origem,
             now()
           )`,
          {
            replacements: {
              id_condominio: idCondominioRef,
              id_plano_anterior: vinculoAtual ? this._toInt(vinculoAtual.id_plano, null) : null,
              id_plano_novo: idPlanoNovo,
              id_condominio_plano: this._toInt(novoVinculo.id, null),
              tipo_alteracao: 'ATUALIZACAO_PLANO',
              motivo: observacaoMudanca || null,
              usuario_responsavel: idUsuarioToken,
              origem: 'API'
            },
            transaction
          }
        );

        await transaction.commit();

        return res.status(200).json({
          message: 'Plano de fatura atualizado com sucesso.',
          data: {
            id_condominio: idCondominioRef,
            plano_anterior: vinculoAtual,
            plano_atual: novoVinculo
          }
        });
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao atualizar plano de fatura do condomínio.',
        detail: error.message
      });
    }
  }

  async listarConsumoTiposAtivos(req, res) {
    try {
      const data = await postgres.query(
        `SELECT
            id,
            nome,
            descricao,
            tipo_cobranca,
            unidade_medida,
            valor_minimo,
            ativo,
            created_at,
            updated_at
          FROM "condominio-bh".tb_consumo_tipo
          WHERE ativo = true
          ORDER BY nome ASC`,
        {
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        total: data.length,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar tipos de consumo ativos.',
        detail: error.message
      });
    }
  }

  async listarConsumoRegistros(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar registros de consumo.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.max(this._toInt(req.query.pageSize, 25), 1);
      const offset = (page - 1) * pageSize;

      const whereParts = [
        'cr.id_condominio = :id_condominio',
        "UPPER(COALESCE(cr.status, '')) = 'ATIVO'"
      ];
      const replacements = {
        id_condominio: idCondominioToken,
        limit: pageSize,
        offset
      };

      const idTipoConsumo = this._getIdTipoConsumoQuery(req.query);
      if (idTipoConsumo) {
        whereParts.push('cr.id_tipo_consumo = :id_tipo_consumo');
        replacements.id_tipo_consumo = idTipoConsumo;
      }

      const idUsuario = this._toInt(req.query.id_usuario, null);
      if (idUsuario) {
        whereParts.push('cr.id_usuario = :id_usuario');
        replacements.id_usuario = idUsuario;
      }

      const morador =
        this._normalizarTextoOuNull(req.query.morador) ||
        this._normalizarTextoOuNull(req.query.unidade);
      if (morador) {
        whereParts.push(`(
          tu.nome ILIKE :morador
          OR tu.sobrenome ILIKE :morador
          OR TRIM(COALESCE(tu.nome, '') || ' ' || COALESCE(tu.sobrenome, '')) ILIKE :morador
        )`);
        replacements.morador = `%${morador}%`;
      }

      const competencia = this._normalizarTextoOuNull(req.query.competencia);
      if (competencia) {
        whereParts.push('cr.competencia = :competencia::date');
        replacements.competencia = competencia;
      }

      const periodoInicio =
        this._normalizarTextoOuNull(req.query.periodo_inicio) ||
        this._normalizarTextoOuNull(req.query.periodoInicio);
      if (periodoInicio) {
        whereParts.push('cr.created_at >= :periodo_inicio::date');
        replacements.periodo_inicio = periodoInicio;
      }

      const periodoFim =
        this._normalizarTextoOuNull(req.query.periodo_fim) ||
        this._normalizarTextoOuNull(req.query.periodoFim);
      if (periodoFim) {
        whereParts.push("cr.created_at < (:periodo_fim::date + INTERVAL '1 day')");
        replacements.periodo_fim = periodoFim;
      }

      const whereClause = whereParts.join(' AND ');

      const totalResult = await postgres.query(
        `SELECT COUNT(1)::int AS total
           FROM "condominio-bh".tb_consumo_registros cr
           LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = cr.id_usuario
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            cr.id,
            cr.id_tipo_consumo,
            ct.nome AS nome_tipo_consumo,
            cr.id_usuario,
            tu.nome AS nome_usuario,
            cr.competencia,
            cr.leitura_anterior,
            cr.leitura_atual,
            cr.consumo,
            cr.valor_unitario,
            cr.valor_total,
            cr.cobr_valor_minimo,
            cr.observacao,
            cr.status,
            cr.id_condominio,
            cr.id_usuario_cadastro,
            cr.origem_imagem,
            cr.created_at,
            cr.updated_at
          FROM "condominio-bh".tb_consumo_registros cr
          LEFT JOIN "condominio-bh".tb_consumo_tipo ct
            ON ct.id = cr.id_tipo_consumo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = cr.id_usuario
          WHERE ${whereClause}
          ORDER BY cr.competencia DESC, cr.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const dataComImagem = data.map((item) => ({
        ...item,
        imagem_url: buildConsumoImagemProxyUrl(req, item.id, item.origem_imagem)
      }));

      return res.status(200).json({
        page,
        pageSize,
        total: totalResult[0]?.total || 0,
        data: dataComImagem
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar registros de consumo.',
        detail: error.message
      });
    }
  }

  async listarConsumoResumoPorMorador(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar resumo de consumo por morador.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.max(this._toInt(req.query.pageSize, 25), 1);
      const offset = (page - 1) * pageSize;

      const moradorFiltro = this._normalizarTextoOuNull(req.query.morador);
      const statusFiltro = 'ATIVO';
      const idTipoConsumoFiltro = this._getIdTipoConsumoQuery(req.query);
      const periodoInicio =
        this._normalizarTextoOuNull(req.query.periodo_inicio) ||
        this._normalizarTextoOuNull(req.query.periodoInicio);
      const periodoFim =
        this._normalizarTextoOuNull(req.query.periodo_fim) ||
        this._normalizarTextoOuNull(req.query.periodoFim);

      const replacements = {
        id_condominio: idCondominioToken,
        morador: moradorFiltro ? `%${moradorFiltro}%` : null,
        status: statusFiltro || null,
        id_tipo_consumo: idTipoConsumoFiltro,
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
        limit: pageSize,
        offset
      };

      const totalRows = await postgres.query(
        `WITH unidades_com_registro AS (
            SELECT DISTINCT
              cu.id AS id_unidade
            FROM "condominio-bh".tb_consumo_registros cr
            INNER JOIN "condominio-bh"."tb-usuarios" tu
              ON tu.id = cr.id_usuario
            INNER JOIN "condominio-bh".tb_condominios_unidades cu
              ON cu.id_condominio = cr.id_condominio
             AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
            WHERE cr.id_condominio = :id_condominio
              AND UPPER(COALESCE(cr.status, '')) = 'ATIVO'
              AND (:id_tipo_consumo IS NULL OR cr.id_tipo_consumo = :id_tipo_consumo)
              AND (:periodo_inicio IS NULL OR cr.created_at >= :periodo_inicio::date)
              AND (:periodo_fim IS NULL OR cr.created_at < (:periodo_fim::date + INTERVAL '1 day'))
              AND (
                :morador IS NULL
                OR tu.nome ILIKE :morador
                OR tu.email ILIKE :morador
                OR tu.cpf ILIKE :morador
              )
          )
          SELECT COUNT(1)::int AS total
            FROM unidades_com_registro`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `WITH tipos AS (
            SELECT
              ct.id,
              ct.nome
            FROM "condominio-bh".tb_consumo_tipo ct
            WHERE ct.ativo = true
          ),
          unidades_base AS (
            SELECT DISTINCT
              cu.id AS id_unidade,
              cu.unidades_bloco,
              c.id AS id_condominio,
              c.nome AS nome_condominio,
              c.cnpj AS cnpj_condominio,
              c.email AS email_condominio,
              c.telefone AS telefone_condominio,
              c.ativo AS ativo_condominio,
              c.qtde_blocos,
              c.qtde_ap_bloco,
              c.escrita_bloco,
              tu.bloco,
              max(cr.created_at) as dtUltimoCriado,
              ARRAY_AGG(DISTINCT tu.id) AS moradores_ids,
              ARRAY_AGG(DISTINCT tu.nome) AS moradores_nomes
            FROM "condominio-bh".tb_consumo_registros cr
            INNER JOIN "condominio-bh"."tb-usuarios" tu
              ON tu.id = cr.id_usuario
            INNER JOIN "condominio-bh".tb_condominios_unidades cu
              ON cu.id_condominio = cr.id_condominio
             AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
            INNER JOIN "condominio-bh"."tb-condominios" c
              ON c.id = cr.id_condominio
            WHERE cr.id_condominio = :id_condominio
              AND UPPER(COALESCE(cr.status, '')) = 'ATIVO'
              AND (:id_tipo_consumo IS NULL OR cr.id_tipo_consumo = :id_tipo_consumo)
              AND (:periodo_inicio IS NULL OR cr.created_at >= :periodo_inicio::date)
              AND (:periodo_fim IS NULL OR cr.created_at < (:periodo_fim::date + INTERVAL '1 day'))
              AND (
                :morador IS NULL
                OR tu.nome ILIKE :morador
                OR tu.email ILIKE :morador
                OR tu.cpf ILIKE :morador
              )
            GROUP BY
              cu.id,
              cu.unidades_bloco,
              c.id,
              c.nome,
              c.cnpj,
              c.email,
              c.telefone,
              c.ativo,
              c.qtde_blocos,
              tu.bloco,
              c.qtde_ap_bloco,
              c.escrita_bloco

          ),
          lancamentos_unidade_tipo AS (
            SELECT
              cu.id AS id_unidade,
              cr.id_tipo_consumo,
              COUNT(1)::int AS qtd_lancamentos
            FROM "condominio-bh".tb_consumo_registros cr
            INNER JOIN "condominio-bh"."tb-usuarios" tu
              ON tu.id = cr.id_usuario
            INNER JOIN "condominio-bh".tb_condominios_unidades cu
              ON cu.id_condominio = cr.id_condominio
             AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
            WHERE cr.id_condominio = :id_condominio
              AND UPPER(COALESCE(cr.status, '')) = 'ATIVO'
              AND (:id_tipo_consumo IS NULL OR cr.id_tipo_consumo = :id_tipo_consumo)
              AND (:periodo_inicio IS NULL OR cr.created_at >= :periodo_inicio::date)
              AND (:periodo_fim IS NULL OR cr.created_at < (:periodo_fim::date + INTERVAL '1 day'))
              AND (
                :morador IS NULL
                OR tu.nome ILIKE :morador
                OR tu.email ILIKE :morador
                OR tu.cpf ILIKE :morador
              )
            GROUP BY cu.id, cr.id_tipo_consumo
          )
          SELECT
            ub.id_unidade,
            ub.unidades_bloco,
            ub.id_condominio,
            ub.nome_condominio,
            ub.cnpj_condominio,
            ub.email_condominio,
            ub.telefone_condominio,
            ub.ativo_condominio,
            ub.qtde_blocos,
            ub.qtde_ap_bloco,
            ub.bloco,  
            ub.escrita_bloco,
            ub.moradores_ids,
            ub.moradores_nomes,
            ub.dtUltimoCriado,
            COALESCE(SUM(lut.qtd_lancamentos), 0)::int AS total_lancamentos,
            ARRAY_AGG(tipos.id ORDER BY tipos.id) AS tipos_ids,
            ARRAY_AGG(tipos.nome ORDER BY tipos.id) AS tipos_nomes,
            ARRAY_AGG((COALESCE(lut.qtd_lancamentos, 0) > 0)::int ORDER BY tipos.id) AS tipos_flags
          FROM unidades_base ub
          CROSS JOIN tipos
          LEFT JOIN lancamentos_unidade_tipo lut
            ON lut.id_unidade = ub.id_unidade
           AND lut.id_tipo_consumo = tipos.id
          GROUP BY
            ub.id_unidade,
            ub.unidades_bloco,
            ub.id_condominio,
            ub.nome_condominio,
            ub.cnpj_condominio,
            ub.email_condominio,
            ub.dtUltimoCriado,
            ub.telefone_condominio,
            ub.ativo_condominio,
            ub.qtde_blocos,
            ub.qtde_ap_bloco,
            ub.escrita_bloco,
            ub.bloco,
            ub.moradores_ids,
            ub.moradores_nomes
          ORDER BY ub.unidades_bloco ASC, ub.id_unidade ASC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const dataNormalizada = data.map((item) => {
        const tiposIds = Array.isArray(item.tipos_ids) ? item.tipos_ids : [];
        const tiposNomes = Array.isArray(item.tipos_nomes) ? item.tipos_nomes : [];
        const tiposFlags = Array.isArray(item.tipos_flags) ? item.tipos_flags : [];

        const tiposLancamento = {};
        const tiposLancamentoLista = [];

        for (let index = 0; index < tiposIds.length; index += 1) {
          const idTipo = tiposIds[index];
          const nomeTipo = tiposNomes[index] || null;
          const temLancamento = Number(tiposFlags[index]) === 1;

          tiposLancamento[String(idTipo)] = temLancamento;
          tiposLancamentoLista.push({
            id_tipo_consumo: idTipo,
            nome_tipo_consumo: nomeTipo,
            tem_lancamento: temLancamento
          });
        }

        return {
          id_unidade: item.id_unidade,
          unidade_bloco: item.unidades_bloco,
          id_condominio: item.id_condominio,
          nome_condominio: item.nome_condominio,
          cnpj_condominio: item.cnpj_condominio,
          email_condominio: item.email_condominio,
          telefone_condominio: item.telefone_condominio,
          ativo_condominio: item.ativo_condominio,
          qtde_blocos: item.qtde_blocos,
          qtde_ap_bloco: item.qtde_ap_bloco,
          escrita_bloco: item.escrita_bloco,
          bloco: item.bloco,
          dtUltimoCriado: item.dtultimocriado,
          moradores_ids: Array.isArray(item.moradores_ids) ? item.moradores_ids : [],
          moradores_nomes: Array.isArray(item.moradores_nomes) ? item.moradores_nomes : [],
          total_lancamentos: item.total_lancamentos,
          tipos_lancamento: tiposLancamento,
          tipos_lancamento_lista: tiposLancamentoLista
        };
      });

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        filtros: {
          morador: moradorFiltro,
          status: statusFiltro,
          id_tipo_consumo: idTipoConsumoFiltro,
          periodo_inicio: periodoInicio,
          periodo_fim: periodoFim
        },
        data: dataNormalizada
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar resumo de consumo por morador.',
        detail: error.message
      });
    }
  }

  async buscarConsumoResumoPorIdUnidade(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar resumo de consumo por unidade.'
        });
      }

      const idUnidade = this._toInt(req.params.id_unidade, null);
      if (!idUnidade) {
        return res.status(400).json({
          message: 'Parâmetro id_unidade inválido.'
        });
      }

      const moradorFiltro = this._normalizarTextoOuNull(req.query.morador);
      const statusFiltro = 'ATIVO';
      const idTipoConsumoFiltro = this._getIdTipoConsumoQuery(req.query);

      const replacements = {
        id_condominio: idCondominioToken,
        id_unidade: idUnidade,
        morador: moradorFiltro ? `%${moradorFiltro}%` : null,
        status: statusFiltro || null,
        id_tipo_consumo: idTipoConsumoFiltro
      };

      const data = await postgres.query(
        `WITH tipos AS (
            SELECT
              ct.id,
              ct.nome
            FROM "condominio-bh".tb_consumo_tipo ct
            WHERE ct.ativo = true
          ),
          unidades_base AS (
            SELECT
              cu.id AS id_unidade,
              cu.unidades_bloco,
              c.id AS id_condominio,
              c.nome AS nome_condominio,
              c.cnpj AS cnpj_condominio,
              c.email AS email_condominio,
              c.telefone AS telefone_condominio,
              c.ativo AS ativo_condominio,
              c.qtde_blocos,
              c.qtde_ap_bloco,
              max(cr.created_at) as dtUltimoCriado,
              ARRAY_AGG(DISTINCT tu.id) AS moradores_ids,
              ARRAY_AGG(DISTINCT tu.nome) AS moradores_nomes
            FROM "condominio-bh".tb_consumo_registros cr
            INNER JOIN "condominio-bh"."tb-usuarios" tu
              ON tu.id = cr.id_usuario
            INNER JOIN "condominio-bh".tb_condominios_unidades cu
              ON cu.id_condominio = cr.id_condominio
             AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
            INNER JOIN "condominio-bh"."tb-condominios" c
              ON c.id = cr.id_condominio
            WHERE cr.id_condominio = :id_condominio
              AND cu.id = :id_unidade
              AND UPPER(COALESCE(cr.status, '')) = 'ATIVO'
              AND (:id_tipo_consumo IS NULL OR cr.id_tipo_consumo = :id_tipo_consumo)
              AND (
                :morador IS NULL
                OR tu.nome ILIKE :morador
                OR tu.email ILIKE :morador
                OR tu.cpf ILIKE :morador
              )
            GROUP BY
              cu.id,
              cu.unidades_bloco,
              c.id,
              c.nome,
              c.cnpj,
              c.email,
              c.telefone,
              c.ativo,
              c.qtde_blocos,
              c.qtde_ap_bloco
          ),
          lancamentos_unidade_tipo AS (
            SELECT
              cu.id AS id_unidade,
              cr.id_tipo_consumo,
              COUNT(1)::int AS qtd_lancamentos
            FROM "condominio-bh".tb_consumo_registros cr
            INNER JOIN "condominio-bh"."tb-usuarios" tu
              ON tu.id = cr.id_usuario
            INNER JOIN "condominio-bh".tb_condominios_unidades cu
              ON cu.id_condominio = cr.id_condominio
             AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
            WHERE cr.id_condominio = :id_condominio
              AND cu.id = :id_unidade
              AND UPPER(COALESCE(cr.status, '')) = 'ATIVO'
              AND (:id_tipo_consumo IS NULL OR cr.id_tipo_consumo = :id_tipo_consumo)
              AND (
                :morador IS NULL
                OR tu.nome ILIKE :morador
                OR tu.email ILIKE :morador
                OR tu.cpf ILIKE :morador
              )
            GROUP BY cu.id, cr.id_tipo_consumo
          )
          SELECT
            ub.id_unidade,
            ub.unidades_bloco,
            ub.id_condominio,
            ub.nome_condominio,
            ub.cnpj_condominio,
            ub.email_condominio,
            ub.telefone_condominio,
            ub.ativo_condominio,
            ub.qtde_blocos,
            ub.qtde_ap_bloco,
            ub.dtUltimoCriado,
            ub.moradores_ids,
            ub.moradores_nomes,
            COALESCE(SUM(lut.qtd_lancamentos), 0)::int AS total_lancamentos,
            ARRAY_AGG(tipos.id ORDER BY tipos.id) AS tipos_ids,
            ARRAY_AGG(tipos.nome ORDER BY tipos.id) AS tipos_nomes,
            ARRAY_AGG((COALESCE(lut.qtd_lancamentos, 0) > 0)::int ORDER BY tipos.id) AS tipos_flags
          FROM unidades_base ub
          CROSS JOIN tipos
          LEFT JOIN lancamentos_unidade_tipo lut
            ON lut.id_unidade = ub.id_unidade
           AND lut.id_tipo_consumo = tipos.id
          GROUP BY
            ub.id_unidade,
            ub.unidades_bloco,
            ub.id_condominio,
            ub.nome_condominio,
            ub.cnpj_condominio,
            ub.email_condominio,
            ub.telefone_condominio,
            ub.ativo_condominio,
            ub.qtde_blocos,
            ub.qtde_ap_bloco,
            ub.dtUltimoCriado,
            ub.moradores_ids,
            ub.moradores_nomes
          LIMIT 1`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      if (!data || data.length === 0) {
        return res.status(404).json({
          message: 'Resumo de consumo da unidade não encontrado.'
        });
      }

      const item = data[0];
      const tiposIds = Array.isArray(item.tipos_ids) ? item.tipos_ids : [];
      const tiposNomes = Array.isArray(item.tipos_nomes) ? item.tipos_nomes : [];
      const tiposFlags = Array.isArray(item.tipos_flags) ? item.tipos_flags : [];

      const tiposLancamento = {};
      const tiposLancamentoLista = [];

      for (let index = 0; index < tiposIds.length; index += 1) {
        const idTipo = tiposIds[index];
        const nomeTipo = tiposNomes[index] || null;
        const temLancamento = Number(tiposFlags[index]) === 1;

        tiposLancamento[String(idTipo)] = temLancamento;
        tiposLancamentoLista.push({
          id_tipo_consumo: idTipo,
          nome_tipo_consumo: nomeTipo,
          tem_lancamento: temLancamento
        });
      }

      return res.status(200).json({
        filtros: {
          id_unidade: idUnidade,
          morador: moradorFiltro,
          status: statusFiltro,
          id_tipo_consumo: idTipoConsumoFiltro
        },
        data: {
          id_unidade: item.id_unidade,
          unidade_bloco: item.unidades_bloco,
          id_condominio: item.id_condominio,
          nome_condominio: item.nome_condominio,
          cnpj_condominio: item.cnpj_condominio,
          email_condominio: item.email_condominio,
          telefone_condominio: item.telefone_condominio,
          ativo_condominio: item.ativo_condominio,
          qtde_blocos: item.qtde_blocos,
          qtde_ap_bloco: item.qtde_ap_bloco,
          dtUltimoCriado: item.dtultimocriado,
          moradores_ids: Array.isArray(item.moradores_ids) ? item.moradores_ids : [],
          moradores_nomes: Array.isArray(item.moradores_nomes) ? item.moradores_nomes : [],
          total_lancamentos: item.total_lancamentos,
          tipos_lancamento: tiposLancamento,
          tipos_lancamento_lista: tiposLancamentoLista
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar resumo de consumo por unidade.',
        detail: error.message
      });
    }
  }

  async listarLancamentosConsumoPorUnidade(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar lançamentos de consumo por unidade.'
        });
      }

      const idUnidade = this._toInt(req.params.id_unidade, null);
      if (!idUnidade) {
        return res.status(400).json({
          message: 'Parâmetro id_unidade inválido.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.max(this._toInt(req.query.pageSize, 25), 1);
      const offset = (page - 1) * pageSize;

      const statusFiltro = 'ATIVO';
      const competenciaFiltro = this._normalizarTextoOuNull(req.query.competencia);
      const idTipoConsumoFiltro = this._getIdTipoConsumoQuery(req.query);

      const whereParts = [
        'cr.id_condominio = :id_condominio',
        'cu.id = :id_unidade'
      ];

      const replacements = {
        id_condominio: idCondominioToken,
        id_unidade: idUnidade,
        limit: pageSize,
        offset
      };

      whereParts.push("UPPER(COALESCE(cr.status, '')) = 'ATIVO'");

      if (competenciaFiltro) {
        whereParts.push('cr.competencia = :competencia::date');
        replacements.competencia = competenciaFiltro;
      }

      if (idTipoConsumoFiltro) {
        whereParts.push('cr.id_tipo_consumo = :id_tipo_consumo');
        replacements.id_tipo_consumo = idTipoConsumoFiltro;
      }

      const whereClause = whereParts.join(' AND ');

      const unidadeInfo = await postgres.query(
        `SELECT
            cu.id,
            cu.unidades_bloco,
            cu.id_condominio
          FROM "condominio-bh".tb_condominios_unidades cu
          WHERE cu.id = :id_unidade
            AND cu.id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id_unidade: idUnidade,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!unidadeInfo || unidadeInfo.length === 0) {
        return res.status(404).json({
          message: 'Unidade não encontrada para este condomínio.'
        });
      }

      const totalRows = await postgres.query(
        `SELECT COUNT(1)::int AS total
           FROM "condominio-bh".tb_consumo_registros cr
           INNER JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = cr.id_usuario
           INNER JOIN "condominio-bh".tb_condominios_unidades cu
             ON cu.id_condominio = cr.id_condominio
            AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            cr.id,
            cr.id_tipo_consumo,
            ct.nome AS nome_tipo_consumo,
            cr.id_usuario,
            tu.nome AS nome_usuario,
            tu.sobrenome AS sobrenome_usuario,
            tu.apartamento,
            cr.competencia,
            cr.leitura_anterior,
            cr.leitura_atual,
            cr.consumo,
            cr.valor_unitario,
            cr.valor_total,
            cr.cobr_valor_minimo,
            cr.observacao,
            cr.status,
            cr.id_condominio,
            cr.id_usuario_cadastro,
            tu_cadastro.nome AS nome_usuario_cadastro,
            tu_cadastro.sobrenome AS sobrenome_usuario_cadastro,
            perfil_cadastro.nome AS descricao_perfil_usuario_cadastro,
            cr.origem_imagem,
            cr.created_at,
            cr.updated_at,
            cu.id AS id_unidade,
            cu.unidades_bloco AS unidade_bloco
          FROM "condominio-bh".tb_consumo_registros cr
          INNER JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = cr.id_usuario
          INNER JOIN "condominio-bh".tb_condominios_unidades cu
            ON cu.id_condominio = cr.id_condominio
           AND TRIM(LOWER(cu.unidades_bloco)) = TRIM(LOWER(COALESCE(tu.apartamento, '')))
          LEFT JOIN "condominio-bh".tb_consumo_tipo ct
            ON ct.id = cr.id_tipo_consumo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu_cadastro
            ON tu_cadastro.id::text = cr.id_usuario_cadastro::text
          LEFT JOIN "condominio-bh".tb_sgw_perfil perfil_cadastro
            ON perfil_cadastro.id::text = tu_cadastro.tipo_perfil_id::text
          WHERE ${whereClause}
          ORDER BY cr.competencia DESC, cr.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      const dataComImagem = data.map((item) => ({
        ...item,
        imagem_url: buildConsumoImagemProxyUrl(req, item.id, item.origem_imagem)
      }));

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        filtros: {
          id_unidade: idUnidade,
          status: statusFiltro,
          competencia: competenciaFiltro,
          id_tipo_consumo: idTipoConsumoFiltro
        },
        unidade: unidadeInfo[0],
        data: dataComImagem
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar lançamentos de consumo por unidade.',
        detail: error.message
      });
    }
  }

  async buscarConsumoRegistroPorId(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar registro de consumo.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({
          message: 'Id do registro inválido.'
        });
      }

      const data = await postgres.query(
        `SELECT
            cr.id,
            cr.id_tipo_consumo,
            ct.nome AS nome_tipo_consumo,
            cr.id_usuario,
            tu.nome AS nome_usuario,
            cr.competencia,
            cr.leitura_anterior,
            cr.leitura_atual,
            cr.consumo,
            cr.valor_unitario,
            cr.valor_total,
            cr.cobr_valor_minimo,
            cr.observacao,
            cr.status,
            cr.id_condominio,
            cr.id_usuario_cadastro,
            cr.origem_imagem,
            cr.created_at,
            cr.updated_at
          FROM "condominio-bh".tb_consumo_registros cr
          LEFT JOIN "condominio-bh".tb_consumo_tipo ct
            ON ct.id = cr.id_tipo_consumo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = cr.id_usuario
          WHERE cr.id = :id
            AND cr.id_condominio = :id_condominio
            AND UPPER(COALESCE(cr.status, '')) = 'ATIVO'
          LIMIT 1`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!data || data.length === 0) {
        return res.status(404).json({
          message: 'Registro de consumo não encontrado.'
        });
      }

      const registro = {
        ...data[0],
        imagem_url: buildConsumoImagemProxyUrl(req, data[0].id, data[0].origem_imagem)
      };

      return res.status(200).json({
        data: registro
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar registro de consumo.',
        detail: error.message
      });
    }
  }

  async criarConsumoRegistro(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para criar registro de consumo.'
        });
      }

      const idUsuarioCadastro = this._toInt(req.idcliente, null);
      if (!idUsuarioCadastro) {
        return res.status(403).json({
          message: 'Token sem id de usuário para registrar consumo.'
        });
      }

      const parseNumero = (value) => {
        if (value === undefined || value === null || String(value).trim() === '') {
          return null;
        }
        const parsed = Number(String(value).replace(',', '.'));
        return Number.isNaN(parsed) ? null : parsed;
      };

      const parseBoolean = (value, defaultValue = false) => {
        if (value === undefined || value === null || value === '') {
          return defaultValue;
        }

        if (typeof value === 'boolean') {
          return value;
        }

        const normalized = String(value).trim().toLowerCase();
        if (['true', '1', 'sim', 'yes'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'nao', 'não', 'no'].includes(normalized)) {
          return false;
        }
        return defaultValue;
      };

      const idTipoConsumo = this._toInt(req.body.id_tipo_consumo, null);
      const idUsuario = this._toInt(req.body.id_usuario, null);
      const idCondominioBody = this._toInt(req.body.id_condominio, null);
      const leituraAtual = parseNumero(req.body.leitura_atual);

      if (!idTipoConsumo || !idUsuario || !idCondominioBody || leituraAtual === null) {
        return res.status(400).json({
          message: 'Campos obrigatórios: id_tipo_consumo, id_condominio, id_usuario e leitura_atual.'
        });
      }

      if (idCondominioBody !== idCondominioToken) {
        return res.status(403).json({
          message: 'id_condominio do payload diferente do condomínio do token.'
        });
      }

      const competencia = this._normalizarTextoOuNull(req.body.competencia) || new Date().toISOString().slice(0, 10);
      const leituraAnterior = parseNumero(req.body.leitura_anterior);
      let consumo = parseNumero(req.body.consumo);
      const valorUnitario = parseNumero(req.body.valor_unitario);
      let valorTotal = parseNumero(req.body.valor_total);

      if (consumo === null && leituraAnterior !== null) {
        consumo = leituraAtual - leituraAnterior;
      }

      if (valorTotal === null && consumo !== null && valorUnitario !== null) {
        valorTotal = consumo * valorUnitario;
      }

      const created = await postgres.query(
        `INSERT INTO "condominio-bh".tb_consumo_registros (
            id_tipo_consumo,
            id_usuario,
            competencia,
            leitura_anterior,
            leitura_atual,
            consumo,
            valor_unitario,
            valor_total,
            cobr_valor_minimo,
            observacao,
            status,
            id_condominio,
            id_usuario_cadastro,
            origem_imagem,
            created_at,
            updated_at
          ) VALUES (
            :id_tipo_consumo,
            :id_usuario,
            :competencia::date,
            :leitura_anterior,
            :leitura_atual,
            :consumo,
            :valor_unitario,
            :valor_total,
            :cobr_valor_minimo,
            :observacao,
            :status,
            :id_condominio,
            :id_usuario_cadastro,
            :origem_imagem,
            now(),
            now()
          )
        RETURNING *`,
        {
          replacements: {
            id_tipo_consumo: idTipoConsumo,
            id_usuario: idUsuario,
            competencia,
            leitura_anterior: leituraAnterior,
            leitura_atual: leituraAtual,
            consumo,
            valor_unitario: valorUnitario,
            valor_total: valorTotal,
            cobr_valor_minimo: parseBoolean(req.body.cobr_valor_minimo, false),
            observacao: this._normalizarTextoOuNull(req.body.observacao),
            status: this._normalizarTextoOuNull(req.body.status) || 'ativo',
            id_condominio: idCondominioToken,
            id_usuario_cadastro: String(idUsuarioCadastro),
            origem_imagem: this._normalizarTextoOuNull(req.body.origem_imagem)
          }
        }
      );

      const registro = created[0][0];

      const arquivoImagem =
        req.files?.imagem?.[0] ||
        req.files?.foto?.[0] ||
        req.files?.arquivo?.[0] ||
        req.file ||
        null;

      if (arquivoImagem?.buffer) {
        try {
          const urlImagem = await this._uploadImagemBlob(arquivoImagem, idCondominioToken, `consumo/registros/${registro.id}`, null);

          await postgres.query(
            `UPDATE "condominio-bh".tb_consumo_registros
                SET origem_imagem = :origem_imagem,
                    updated_at = now()
              WHERE id = :id
                AND id_condominio = :id_condominio`,
            {
              replacements: {
                id: registro.id,
                id_condominio: idCondominioToken,
                origem_imagem: urlImagem
              },
              type: QueryTypes.UPDATE
            }
          );

          registro.origem_imagem = urlImagem;
        } catch (uploadError) {
          return res.status(500).json({
            message: 'Registro criado, mas falha ao salvar imagem.',
            detail: uploadError.message,
            data: registro
          });
        }
      }

      return res.status(201).json({
        message: 'Registro de consumo criado com sucesso.',
        data: registro
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao criar registro de consumo.',
        detail: error.message
      });
    }
  }

  async editarConsumoRegistro(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para editar registro de consumo.'
        });
      }

      const idUsuarioCadastro = this._toInt(req.idcliente, null);
      if (!idUsuarioCadastro) {
        return res.status(403).json({
          message: 'Token sem id de usuário para registrar edição de consumo.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({
          message: 'Id do registro inválido.'
        });
      }

      const parseNumero = (value) => {
        if (value === undefined || value === null || String(value).trim() === '') {
          return null;
        }
        const parsed = Number(String(value).replace(',', '.'));
        return Number.isNaN(parsed) ? null : parsed;
      };

      const parseBoolean = (value, defaultValue = false) => {
        if (value === undefined || value === null || value === '') {
          return defaultValue;
        }

        if (typeof value === 'boolean') {
          return value;
        }

        const normalized = String(value).trim().toLowerCase();
        if (['true', '1', 'sim', 'yes'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'nao', 'não', 'no'].includes(normalized)) {
          return false;
        }
        return defaultValue;
      };

      const idTipoConsumo = this._toInt(req.body.id_tipo_consumo, null);
      const idUsuario = this._toInt(req.body.id_usuario, null);
      const idCondominioBody = this._toInt(req.body.id_condominio, null);
      const leituraAtual = parseNumero(req.body.leitura_atual);

      if (!idTipoConsumo || !idUsuario || !idCondominioBody || leituraAtual === null) {
        return res.status(400).json({
          message: 'Campos obrigatórios: id_tipo_consumo, id_condominio, id_usuario e leitura_atual.'
        });
      }

      if (idCondominioBody !== idCondominioToken) {
        return res.status(403).json({
          message: 'id_condominio do payload diferente do condomínio do token.'
        });
      }

      const atual = await postgres.query(
        `SELECT id, status
           FROM "condominio-bh".tb_consumo_registros
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!atual || atual.length === 0) {
        return res.status(404).json({
          message: 'Registro de consumo não encontrado.'
        });
      }

      const statusPayload = this._getStatusConsumoPayload(req.body);
      const statusAtual = this._normalizarTextoOuNull(atual[0]?.status);
      const statusFinal = statusPayload || statusAtual || 'ativo';

      const competencia = this._normalizarTextoOuNull(req.body.competencia) || new Date().toISOString().slice(0, 10);
      const leituraAnterior = parseNumero(req.body.leitura_anterior);
      let consumo = parseNumero(req.body.consumo);
      const valorUnitario = parseNumero(req.body.valor_unitario);
      let valorTotal = parseNumero(req.body.valor_total);

      if (consumo === null && leituraAnterior !== null) {
        consumo = leituraAtual - leituraAnterior;
      }

      if (valorTotal === null && consumo !== null && valorUnitario !== null) {
        valorTotal = consumo * valorUnitario;
      }

      const updated = await postgres.query(
        `UPDATE "condominio-bh".tb_consumo_registros
            SET id_tipo_consumo = :id_tipo_consumo,
                id_usuario = :id_usuario,
                competencia = :competencia::date,
                leitura_anterior = :leitura_anterior,
                leitura_atual = :leitura_atual,
                consumo = :consumo,
                valor_unitario = :valor_unitario,
                valor_total = :valor_total,
                cobr_valor_minimo = :cobr_valor_minimo,
                observacao = :observacao,
                status = :status,
                id_usuario_cadastro = :id_usuario_cadastro,
                id_usuario_update = :id_usuario_update,
                origem_imagem = :origem_imagem,
                updated_at = now()
          WHERE id = :id
            AND id_condominio = :id_condominio
        RETURNING *`,
        {
          replacements: {
            id,
            id_tipo_consumo: idTipoConsumo,
            id_usuario: idUsuario,
            competencia,
            leitura_anterior: leituraAnterior,
            leitura_atual: leituraAtual,
            consumo,
            valor_unitario: valorUnitario,
            valor_total: valorTotal,
            cobr_valor_minimo: parseBoolean(req.body.cobr_valor_minimo, false),
            observacao: this._normalizarTextoOuNull(req.body.observacao),
            status: statusFinal,
            id_usuario_cadastro: String(idUsuarioCadastro),
            id_usuario_update: String(idUsuarioCadastro),
            origem_imagem: this._normalizarTextoOuNull(req.body.origem_imagem),
            id_condominio: idCondominioToken
          }
        }
      );

      if (!updated[0] || updated[0].length === 0) {
        return res.status(404).json({
          message: 'Registro de consumo não encontrado.'
        });
      }

      const registroAtualizado = updated[0][0];

      const arquivoImagem =
        req.files?.imagem?.[0] ||
        req.files?.foto?.[0] ||
        req.files?.arquivo?.[0] ||
        req.file ||
        null;

      if (arquivoImagem?.buffer) {
        try {
          const urlImagem = await this._uploadImagemBlob(
            arquivoImagem,
            idCondominioToken,
            `consumo/registros/${id}`,
            registroAtualizado.origem_imagem
          );

          await postgres.query(
            `UPDATE "condominio-bh".tb_consumo_registros
                SET origem_imagem = :origem_imagem,
                    updated_at = now()
              WHERE id = :id
                AND id_condominio = :id_condominio`,
            {
              replacements: {
                id,
                id_condominio: idCondominioToken,
                origem_imagem: urlImagem
              },
              type: QueryTypes.UPDATE
            }
          );

          registroAtualizado.origem_imagem = urlImagem;
        } catch (uploadError) {
          return res.status(500).json({
            message: 'Registro atualizado, mas falha ao salvar imagem.',
            detail: uploadError.message,
            data: registroAtualizado
          });
        }
      }

      return res.status(200).json({
        message: 'Registro de consumo atualizado com sucesso.',
        data: registroAtualizado
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao atualizar registro de consumo.',
        detail: error.message
      });
    }
  }

  async buscarImagemConsumoRegistro(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({ message: 'Token sem id_condominio.' });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Parâmetro id inválido.' });
      }

      const rows = await postgres.query(
        `SELECT origem_imagem
           FROM "condominio-bh".tb_consumo_registros
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: { id, id_condominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: 'Registro de consumo não encontrado.' });
      }

      const origemImagem = this._normalizarTextoOuNull(rows[0].origem_imagem);
      if (!origemImagem) {
        return res.status(404).json({ message: 'Registro não possui imagem anexada.' });
      }

      const blobUrl = resolveBlobUrl(origemImagem);
      if (!blobUrl) {
        return res.status(500).json({ message: 'Falha ao resolver URL da imagem no blob.' });
      }

      const blobToken = getBlobReadToken();
      if (!blobToken) {
        return res.status(500).json({ message: 'Token do Vercel Blob não configurado para leitura.' });
      }

      const blobResponse = await fetch(blobUrl, {
        headers: { Authorization: `Bearer ${blobToken}` }
      });

      if (!blobResponse.ok) {
        if (blobResponse.status === 404) {
          return res.status(404).json({ message: 'Imagem não encontrada no blob.' });
        }
        return res.status(502).json({
          message: 'Falha ao ler imagem no blob.',
          detail: `Blob retornou status ${blobResponse.status}.`
        });
      }

      const payload = await blobResponse.buffer();
      const contentType = blobResponse.headers.get('content-type') || 'application/octet-stream';
      const cacheControl = blobResponse.headers.get('cache-control') || 'private, max-age=300';
      const etag = blobResponse.headers.get('etag');

      res.set('Content-Type', contentType);
      res.set('Cache-Control', cacheControl);
      if (etag) {
        res.set('ETag', etag);
      }

      return res.status(200).send(payload);
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar imagem do registro de consumo.',
        detail: error.message
      });
    }
  }

  async atualizarParcialConsumoRegistro(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para editar registro de consumo.'
        });
      }

      const idUsuarioCadastro = this._toInt(req.idcliente, null);
      if (!idUsuarioCadastro) {
        return res.status(403).json({
          message: 'Token sem id de usuário para registrar edição de consumo.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({
          message: 'Id do registro inválido.'
        });
      }

      const atual = await postgres.query(
        `SELECT *
           FROM "condominio-bh".tb_consumo_registros
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!atual || atual.length === 0) {
        return res.status(404).json({
          message: 'Registro de consumo não encontrado.'
        });
      }

      const parseNumero = (value) => {
        if (value === undefined || value === null || String(value).trim() === '') {
          return null;
        }
        const parsed = Number(String(value).replace(',', '.'));
        return Number.isNaN(parsed) ? null : parsed;
      };

      const parseBoolean = (value, defaultValue = null) => {
        if (value === undefined || value === null || value === '') {
          return defaultValue;
        }

        if (typeof value === 'boolean') {
          return value;
        }

        const normalized = String(value).trim().toLowerCase();
        if (['true', '1', 'sim', 'yes'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'nao', 'não', 'no'].includes(normalized)) {
          return false;
        }
        return defaultValue;
      };

      const registroAtual = atual[0];
      const idCondominioBody = this._toInt(req.body.id_condominio, null);
      if (idCondominioBody && idCondominioBody !== idCondominioToken) {
        return res.status(403).json({
          message: 'id_condominio do payload diferente do condomínio do token.'
        });
      }

      const idTipoConsumo = req.body.id_tipo_consumo !== undefined
        ? this._toInt(req.body.id_tipo_consumo, null)
        : this._toInt(registroAtual.id_tipo_consumo, null);
      const idUsuario = req.body.id_usuario !== undefined
        ? this._toInt(req.body.id_usuario, null)
        : this._toInt(registroAtual.id_usuario, null);

      let leituraAnterior = req.body.leitura_anterior !== undefined
        ? parseNumero(req.body.leitura_anterior)
        : parseNumero(registroAtual.leitura_anterior);
      let leituraAtual = req.body.leitura_atual !== undefined
        ? parseNumero(req.body.leitura_atual)
        : parseNumero(registroAtual.leitura_atual);
      let consumo = req.body.consumo !== undefined
        ? parseNumero(req.body.consumo)
        : parseNumero(registroAtual.consumo);
      let valorUnitario = req.body.valor_unitario !== undefined
        ? parseNumero(req.body.valor_unitario)
        : parseNumero(registroAtual.valor_unitario);
      let valorTotal = req.body.valor_total !== undefined
        ? parseNumero(req.body.valor_total)
        : parseNumero(registroAtual.valor_total);

      if (req.body.consumo === undefined && leituraAnterior !== null && leituraAtual !== null) {
        consumo = leituraAtual - leituraAnterior;
      }

      if (req.body.valor_total === undefined && consumo !== null && valorUnitario !== null) {
        valorTotal = consumo * valorUnitario;
      }

      const competencia = req.body.competencia !== undefined
        ? this._normalizarTextoOuNull(req.body.competencia)
        : registroAtual.competencia;

      const cobrValorMinimo = parseBoolean(req.body.cobr_valor_minimo, registroAtual.cobr_valor_minimo);
      const observacao = req.body.observacao !== undefined
        ? this._normalizarTextoOuNull(req.body.observacao)
        : registroAtual.observacao;
      const statusPayload = this._getStatusConsumoPayload(req.body);
      const status = statusPayload || registroAtual.status;
      const origemImagem = req.body.origem_imagem !== undefined
        ? this._normalizarTextoOuNull(req.body.origem_imagem)
        : registroAtual.origem_imagem;

      const updated = await postgres.query(
        `UPDATE "condominio-bh".tb_consumo_registros
            SET id_tipo_consumo = :id_tipo_consumo,
                id_usuario = :id_usuario,
                competencia = :competencia::date,
                leitura_anterior = :leitura_anterior,
                leitura_atual = :leitura_atual,
                consumo = :consumo,
                valor_unitario = :valor_unitario,
                valor_total = :valor_total,
                cobr_valor_minimo = :cobr_valor_minimo,
                observacao = :observacao,
                status = :status,
                id_usuario_cadastro = :id_usuario_cadastro,
                id_usuario_update = :id_usuario_update,
                origem_imagem = :origem_imagem,
                updated_at = now()
          WHERE id = :id
            AND id_condominio = :id_condominio
        RETURNING *`,
        {
          replacements: {
            id,
            id_tipo_consumo: idTipoConsumo,
            id_usuario: idUsuario,
            competencia,
            leitura_anterior: leituraAnterior,
            leitura_atual: leituraAtual,
            consumo,
            valor_unitario: valorUnitario,
            valor_total: valorTotal,
            cobr_valor_minimo: cobrValorMinimo,
            observacao,
            status,
            id_usuario_cadastro: String(idUsuarioCadastro),
            id_usuario_update: String(idUsuarioCadastro),
            origem_imagem: origemImagem,
            id_condominio: idCondominioToken
          }
        }
      );

      return res.status(200).json({
        message: 'Registro de consumo atualizado com sucesso.',
        data: updated[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao atualizar parcialmente registro de consumo.',
        detail: error.message
      });
    }
  }

  async listarPerfis(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);

      if (!idPerfilToken) {
        return res.status(403).json({
          message: 'Token sem perfil para listar perfis.'
        });
      }

      let whereClause = 'p.status = true';
      const replacements = {};

      if (idPerfilToken === 1) {
        // Admin pode ver todos os perfis ativos.
      } else if (idPerfilToken === 3) {
        // Sindico: não pode ver Admin.
        whereClause += ' AND p.id NOT IN (:ids_bloqueados)';
        replacements.ids_bloqueados = [1];
      } else if (idPerfilToken === 4) {
        // Sub-Sindico: não pode ver Admin e Sindico.
        whereClause += ' AND p.id NOT IN (:ids_bloqueados)';
        replacements.ids_bloqueados = [1, 3];
      } else {
        // Demais perfis: não retorna nada.
        return res.status(200).json({
          total: 0,
          data: []
        });
      }

      const data = await postgres.query(
        `SELECT p.id, p.nome, p.status
           FROM "condominio-bh".tb_sgw_perfil p
          WHERE ${whereClause}
          ORDER BY p.id ASC`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        total: data.length,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar perfis.',
        detail: error.message
      });
    }
  }

  async listarPermissoesMenuPorPerfil(req, res) {
    try {
      if (!this._podeGerenciarPermissoesMenu(req)) {
        return res.status(403).json({
          message: 'Usuário sem permissão para gerenciar permissões de menu.'
        });
      }

      const idPerfil = this._toInt(req.params.id_perfil, null);
      if (!idPerfil) {
        return res.status(400).json({
          message: 'Parâmetro id_perfil inválido.'
        });
      }

      const perfil = await postgres.query(
        `SELECT id, nome, status
           FROM "condominio-bh".tb_sgw_perfil
          WHERE id = :id_perfil
          LIMIT 1`,
        {
          replacements: {
            id_perfil: idPerfil
          },
          type: QueryTypes.SELECT
        }
      );

      if (!perfil || perfil.length === 0) {
        return res.status(404).json({
          message: 'Perfil não encontrado.'
        });
      }

      const data = await postgres.query(
        `SELECT
            m.id,
            m.nome,
            m.rota,
            m.icone,
            m.nivel,
            m.id_menu_pai,
            m.ordem,
            m.status,
            COALESCE(pm.pode_ver, false) AS pode_ver,
            COALESCE(pm.pode_criar, false) AS pode_criar,
            COALESCE(pm.pode_editar, false) AS pode_editar,
            COALESCE(pm.pode_excluir, false) AS pode_excluir
          FROM "condominio-bh".tb_sgw_menu m
          LEFT JOIN (
            SELECT
              id_menu,
              BOOL_OR(COALESCE(pode_ver, false)) AS pode_ver,
              BOOL_OR(COALESCE(pode_criar, false)) AS pode_criar,
              BOOL_OR(COALESCE(pode_editar, false)) AS pode_editar,
              BOOL_OR(COALESCE(pode_excluir, false)) AS pode_excluir
            FROM "condominio-bh".tb_sgw_perfil_menu
            WHERE id_perfil = :id_perfil
            GROUP BY id_menu
          ) pm
            ON pm.id_menu = m.id
          WHERE m.status = true
          ORDER BY m.nivel ASC, m.ordem ASC, m.id ASC`,
        {
          replacements: {
            id_perfil: idPerfil
          },
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        perfil: perfil[0],
        total: data.length,
        data: data.map((item) => ({
          id: this._toInt(item.id, null),
          nome: item.nome,
          rota: item.rota || null,
          icone: item.icone || null,
          nivel: this._toInt(item.nivel, 0),
          id_menu_pai: this._toInt(item.id_menu_pai, 0),
          ordem: this._toInt(item.ordem, 0),
          status: Boolean(item.status),
          pode_ver: Boolean(item.pode_ver),
          pode_criar: Boolean(item.pode_criar),
          pode_editar: Boolean(item.pode_editar),
          pode_excluir: Boolean(item.pode_excluir)
        }))
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar permissões de menu do perfil.',
        detail: error.message
      });
    }
  }

  async listarConfiguracaoPermissoesMenu(req, res) {
    try {
      if (!this._podeGerenciarPermissoesMenu(req)) {
        return res.status(403).json({
          message: 'Usuário sem permissão para gerenciar permissões de menu.'
        });
      }

      const idPerfilQuery = this._toInt(req.query.id_perfil, null);

      const perfis = await postgres.query(
        `SELECT id, nome, status
           FROM "condominio-bh".tb_sgw_perfil
          ORDER BY id ASC`,
        {
          type: QueryTypes.SELECT
        }
      );

      if (!perfis || perfis.length === 0) {
        return res.status(200).json({
          total_perfis: 0,
          total_menus: 0,
          perfil_selecionado: null,
          perfis: [],
          menus: []
        });
      }

      const perfilSelecionado =
        perfis.find((perfil) => this._toInt(perfil.id, null) === idPerfilQuery) || perfis[0];
      const idPerfilSelecionado = this._toInt(perfilSelecionado.id, null);

      const menus = await postgres.query(
        `SELECT
            m.id,
            m.nome,
            m.rota,
            m.icone,
            m.nivel,
            m.id_menu_pai,
            m.ordem,
            m.status,
            COALESCE(pm.pode_ver, false) AS pode_ver,
            COALESCE(pm.pode_criar, false) AS pode_criar,
            COALESCE(pm.pode_editar, false) AS pode_editar,
            COALESCE(pm.pode_excluir, false) AS pode_excluir
          FROM "condominio-bh".tb_sgw_menu m
          LEFT JOIN (
            SELECT
              id_menu,
              BOOL_OR(COALESCE(pode_ver, false)) AS pode_ver,
              BOOL_OR(COALESCE(pode_criar, false)) AS pode_criar,
              BOOL_OR(COALESCE(pode_editar, false)) AS pode_editar,
              BOOL_OR(COALESCE(pode_excluir, false)) AS pode_excluir
            FROM "condominio-bh".tb_sgw_perfil_menu
            WHERE id_perfil = :id_perfil
            GROUP BY id_menu
          ) pm
            ON pm.id_menu = m.id
          ORDER BY m.nivel ASC, m.ordem ASC, m.id ASC`,
        {
          replacements: {
            id_perfil: idPerfilSelecionado
          },
          type: QueryTypes.SELECT
        }
      );

      const mapMenus = new Map();

      for (const item of menus) {
        const idMenu = this._toInt(item.id, null);
        const idMenuPai = this._toInt(item.id_menu_pai, null);

        if (!idMenu) {
          continue;
        }

        mapMenus.set(idMenu, {
          id: idMenu,
          nome: item.nome,
          rota: item.rota || null,
          icone: item.icone || null,
          nivel: this._toInt(item.nivel, 0),
          id_menu_pai: idMenuPai,
          ordem: this._toInt(item.ordem, 0),
          status: Boolean(item.status),
          pode_ver: Boolean(item.pode_ver),
          pode_criar: Boolean(item.pode_criar),
          pode_editar: Boolean(item.pode_editar),
          pode_excluir: Boolean(item.pode_excluir),
          itens: []
        });
      }

      const raiz = [];

      for (const item of mapMenus.values()) {
        const idPai = this._toInt(item.id_menu_pai, null);
        const ehRaiz = !idPai || !mapMenus.has(idPai);

        if (ehRaiz) {
          raiz.push(item);
          continue;
        }

        mapMenus.get(idPai).itens.push(item);
      }

      const ordenarArvore = (lista) => {
        lista.sort((a, b) => {
          if (a.ordem !== b.ordem) {
            return a.ordem - b.ordem;
          }

          return a.id - b.id;
        });

        for (const item of lista) {
          if (item.itens.length > 0) {
            ordenarArvore(item.itens);
          }
        }
      };

      ordenarArvore(raiz);

      const perfisResponse = perfis.map((perfil) => ({
        id: this._toInt(perfil.id, null),
        nome: perfil.nome,
        status: Boolean(perfil.status)
      }));

      return res.status(200).json({
        total_perfis: perfisResponse.length,
        total_menus: mapMenus.size,
        perfil_selecionado: {
          id: idPerfilSelecionado,
          nome: perfilSelecionado.nome,
          status: Boolean(perfilSelecionado.status)
        },
        perfis: perfisResponse,
        menus: raiz
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao carregar configuração de permissões de menu.',
        detail: error.message
      });
    }
  }

  async substituirPermissoesMenuPorPerfil(req, res) {
    const transaction = await postgres.transaction();

    try {
      if (!this._podeGerenciarPermissoesMenu(req)) {
        await transaction.rollback();
        return res.status(403).json({
          message: 'Usuário sem permissão para gerenciar permissões de menu.'
        });
      }

      const idPerfil = this._toInt(req.params.id_perfil, null);
      if (!idPerfil) {
        await transaction.rollback();
        return res.status(400).json({
          message: 'Parâmetro id_perfil inválido.'
        });
      }

      const permissoesInput = Array.isArray(req.body.permissoes) ? req.body.permissoes : [];

      const menusAtivos = await postgres.query(
        `SELECT id
           FROM "condominio-bh".tb_sgw_menu
          WHERE status = true`,
        {
          type: QueryTypes.SELECT,
          transaction
        }
      );

      const idsMenuAtivos = new Set(menusAtivos.map((item) => this._toInt(item.id, null)));
      const upserts = [];

      for (const permissao of permissoesInput) {
        const idMenu = this._toInt(permissao?.id_menu, null);
        if (!idMenu || !idsMenuAtivos.has(idMenu)) {
          continue;
        }

        upserts.push({
          id_menu: idMenu,
          pode_ver: Boolean(permissao?.pode_ver),
          pode_criar: Boolean(permissao?.pode_criar),
          pode_editar: Boolean(permissao?.pode_editar),
          pode_excluir: Boolean(permissao?.pode_excluir)
        });
      }

      await postgres.query(
        `DELETE FROM "condominio-bh".tb_sgw_perfil_menu
          WHERE id_perfil = :id_perfil`,
        {
          replacements: {
            id_perfil: idPerfil
          },
          type: QueryTypes.DELETE,
          transaction
        }
      );

      for (const item of upserts) {
        await postgres.query(
          `INSERT INTO "condominio-bh".tb_sgw_perfil_menu (
              id_perfil,
              id_menu,
              pode_ver,
              pode_criar,
              pode_editar,
              pode_excluir
            ) VALUES (
              :id_perfil,
              :id_menu,
              :pode_ver,
              :pode_criar,
              :pode_editar,
              :pode_excluir
            )`,
          {
            replacements: {
              id_perfil: idPerfil,
              id_menu: item.id_menu,
              pode_ver: item.pode_ver,
              pode_criar: item.pode_criar,
              pode_editar: item.pode_editar,
              pode_excluir: item.pode_excluir
            },
            type: QueryTypes.INSERT,
            transaction
          }
        );
      }

      await transaction.commit();

      return res.status(200).json({
        message: 'Permissões de menu atualizadas com sucesso.',
        total: upserts.length
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({
        message: 'Falha ao atualizar permissões de menu do perfil.',
        detail: error.message
      });
    }
  }

  async listarCondominios(req, res) {
    try {
      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['1 = 1'];
      const replacements = { limit: pageSize, offset };

      if (req.query.q) {
        const q = String(req.query.q).trim();
        whereParts.push('(c.nome ILIKE :q OR c.email ILIKE :q OR c.telefone ILIKE :q)');
        replacements.q = `%${q}%`;
      }

      if (req.query.ativo !== undefined && req.query.ativo !== null && req.query.ativo !== '') {
        const ativoRaw = String(req.query.ativo).toLowerCase();
        const ativo = ativoRaw === 'true' || ativoRaw === '1';
        whereParts.push('c.ativo = :ativo');
        replacements.ativo = ativo;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh"."tb-condominios" c
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            c.id,
            c.nome,
            c.cnpj,
            c.email,
            c.telefone,
            c.ativo,
            c.qtde_ap_andar,
            c.escrita_bloco,
            c.qtde_ap_bloco,
            c.qtde_blocos,
            c.modelo_fatura,
            c.created_at,
            c.updated_at,
            COALESCE(
              (
                SELECT array_to_json(
                         array_agg(
                           row_to_json(unidade_row)
                           ORDER BY unidade_row.bloco, unidade_row.unidade
                         )
                       )
                  FROM (
                    SELECT cu.id, cu.bloco, cu.unidades_bloco AS unidade
                      FROM "condominio-bh".tb_condominios_unidades cu
                     WHERE cu.id_condominio = c.id
                  ) unidade_row
              ),
              '[]'::json
            ) AS unidades_bloco
          FROM "condominio-bh"."tb-condominios" c
          WHERE ${whereClause}
          ORDER BY c.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar condomínios.',
        detail: error.message
      });
    }
  }

  async buscarCondominioPorId(req, res) {
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id inválido.' });
      }

      const data = await postgres.query(
        `SELECT
            c.id,
            c.nome,
            c.cnpj,
            c.email,
            c.telefone,
            c.ativo,
            c.qtde_ap_andar,
            c.escrita_bloco,
            c.qtde_ap_bloco,
            c.qtde_blocos,
            c.modelo_fatura,
            c.created_at,
            c.updated_at,
            COALESCE(
              (
                SELECT array_to_json(
                         array_agg(
                           row_to_json(unidade_row)
                           ORDER BY unidade_row.bloco, unidade_row.unidade
                         )
                       )
                  FROM (
                    SELECT cu.id, cu.bloco, cu.unidades_bloco AS unidade
                      FROM "condominio-bh".tb_condominios_unidades cu
                     WHERE cu.id_condominio = c.id
                  ) unidade_row
              ),
              '[]'::json
            ) AS unidades_bloco
          FROM "condominio-bh"."tb-condominios" c
          WHERE c.id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT
        }
      );

      if (!data || data.length === 0) {
        return res.status(404).json({ message: 'Condomínio não encontrado.' });
      }

      return res.status(200).json({ data: data[0] });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar condomínio.',
        detail: error.message
      });
    }
  }

  async criarCondominio(req, res) {
    const transaction = await postgres.transaction();
    try {
      const cnpjNormalizado = req.body.cnpj ? String(req.body.cnpj).replace(/\D/g, '') : null;
      const emailNormalizado = String(req.body.email).trim().toLowerCase();
      const qtdeBlocosBody = req.body.qtde_blocos !== undefined ? req.body.qtde_blocos : req.body.qtde_bloco;
      const unidadesBloco = Array.isArray(req.body.unidades_bloco)
        ? req.body.unidades_bloco.map((item) => String(item).trim())
        : [];

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh"."tb-condominios" (
            nome,
            cnpj,
            email,
            telefone,
            ativo,
            qtde_ap_andar,
            escrita_bloco,
            qtde_ap_bloco,
            qtde_blocos,
            modelo_fatura,
            created_at,
            updated_at
          ) VALUES (
            :nome,
            :cnpj,
            :email,
            :telefone,
            :ativo,
            :qtde_ap_andar,
            :escrita_bloco,
            :qtde_ap_bloco,
            :qtde_blocos,
            :modelo_fatura,
            now(),
            now()
          )
          RETURNING
            id,
            nome,
            cnpj,
            email,
            telefone,
            ativo,
            qtde_ap_andar,
            escrita_bloco,
            qtde_ap_bloco,
            qtde_blocos,
            modelo_fatura,
            created_at,
            updated_at`,
        {
          replacements: {
            nome: String(req.body.nome).trim(),
            cnpj: cnpjNormalizado,
            email: emailNormalizado,
            telefone: String(req.body.telefone).trim(),
            ativo: req.body.ativo !== undefined ? Boolean(req.body.ativo) : true,
            qtde_ap_andar: this._toInt(req.body.qtde_ap_andar, null),
            escrita_bloco: String(req.body.escrita_bloco).trim(),
            qtde_ap_bloco: this._toInt(req.body.qtde_ap_bloco, null),
            qtde_blocos: this._toInt(qtdeBlocosBody, null),
            modelo_fatura: String(req.body.modelo_fatura).trim()
          },
          transaction
        }
      );

      const idCondominio = insert[0][0].id;
      await this._sincronizarUnidadesCondominio(
        idCondominio,
        unidadesBloco,
        this._toInt(qtdeBlocosBody, null),
        transaction
      );

      const data = await this._buscarCondominioComUnidades(idCondominio, transaction);
      await transaction.commit();

      return res.status(201).json({
        message: 'Condomínio criado com sucesso.',
        data
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({
        message: 'Falha ao criar condomínio.',
        detail: error.message
      });
    }
  }

  async editarCondominio(req, res) {
    const transaction = await postgres.transaction();
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Id inválido.' });
      }

      const qtdeBlocosBody = req.body.qtde_blocos !== undefined ? req.body.qtde_blocos : req.body.qtde_bloco;
      const unidadesBlocoInformadas = Array.isArray(req.body.unidades_bloco)
        ? req.body.unidades_bloco.map((item) => String(item).trim())
        : null;

      const atual = await postgres.query(
        `SELECT *
           FROM "condominio-bh"."tb-condominios"
          WHERE id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT,
          transaction
        }
      );

      if (!atual || atual.length === 0) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Condomínio não encontrado.' });
      }

      const registroAtual = atual[0];

      const update = await postgres.query(
        `UPDATE "condominio-bh"."tb-condominios"
            SET nome = :nome,
                cnpj = :cnpj,
                email = :email,
                telefone = :telefone,
                ativo = :ativo,
                qtde_ap_andar = :qtde_ap_andar,
                escrita_bloco = :escrita_bloco,
                qtde_ap_bloco = :qtde_ap_bloco,
                qtde_blocos = :qtde_blocos,
                modelo_fatura = :modelo_fatura,
                updated_at = now()
          WHERE id = :id
          RETURNING
            id,
            nome,
            cnpj,
            email,
            telefone,
            ativo,
            qtde_ap_andar,
            escrita_bloco,
            qtde_ap_bloco,
            qtde_blocos,
            modelo_fatura,
            created_at,
            updated_at`,
        {
          replacements: {
            id,
            nome:
              req.body.nome !== undefined ? String(req.body.nome).trim() : String(registroAtual.nome || ''),
            cnpj:
              req.body.cnpj !== undefined
                ? String(req.body.cnpj || '').replace(/\D/g, '') || null
                : registroAtual.cnpj,
            email:
              req.body.email !== undefined
                ? String(req.body.email || '').trim().toLowerCase() || null
                : registroAtual.email,
            telefone:
              req.body.telefone !== undefined
                ? String(req.body.telefone || '').trim() || null
                : registroAtual.telefone,
            ativo: req.body.ativo !== undefined ? Boolean(req.body.ativo) : Boolean(registroAtual.ativo),
            qtde_ap_andar:
              req.body.qtde_ap_andar !== undefined
                ? this._toInt(req.body.qtde_ap_andar, null)
                : this._toInt(registroAtual.qtde_ap_andar, null),
            escrita_bloco:
              req.body.escrita_bloco !== undefined
                ? String(req.body.escrita_bloco || '').trim() || null
                : registroAtual.escrita_bloco,
            qtde_ap_bloco:
              req.body.qtde_ap_bloco !== undefined
                ? this._toInt(req.body.qtde_ap_bloco, null)
                : this._toInt(registroAtual.qtde_ap_bloco, null),
            qtde_blocos:
              qtdeBlocosBody !== undefined
                ? this._toInt(qtdeBlocosBody, null)
                : this._toInt(registroAtual.qtde_blocos, null),
            modelo_fatura:
              req.body.modelo_fatura !== undefined
                ? String(req.body.modelo_fatura || '').trim() || null
                : registroAtual.modelo_fatura
          },
          transaction
        }
      );

      if (unidadesBlocoInformadas) {
        const qtdeBlocosResolvida =
          qtdeBlocosBody !== undefined
            ? this._toInt(qtdeBlocosBody, null)
            : this._toInt(registroAtual.qtde_blocos, null);
        await this._sincronizarUnidadesCondominio(
          id,
          unidadesBlocoInformadas,
          qtdeBlocosResolvida,
          transaction
        );
      }

      const data = await this._buscarCondominioComUnidades(id, transaction);
      await transaction.commit();

      return res.status(200).json({
        message: 'Condomínio atualizado com sucesso.',
        data
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({
        message: 'Falha ao atualizar condomínio.',
        detail: error.message
      });
    }
  }

  async listarMenuDinamico(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);

      if (!idPerfilToken) {
        return res.status(403).json({
          message: 'Token sem perfil para listar menu.'
        });
      }

      const menus = await postgres.query(
        `SELECT
            m.id,
            m.nome,
            m.rota,
            m.icone,
            m.nivel,
            m.id_menu_pai,
            m.ordem,
            m.status,
            COALESCE(pm.pode_ver, false) AS pode_ver,
            COALESCE(pm.pode_criar, false) AS pode_criar,
            COALESCE(pm.pode_editar, false) AS pode_editar,
            COALESCE(pm.pode_excluir, false) AS pode_excluir
          FROM "condominio-bh".tb_sgw_menu m
          LEFT JOIN (
            SELECT
              id_menu,
              BOOL_OR(COALESCE(pode_ver, false)) AS pode_ver,
              BOOL_OR(COALESCE(pode_criar, false)) AS pode_criar,
              BOOL_OR(COALESCE(pode_editar, false)) AS pode_editar,
              BOOL_OR(COALESCE(pode_excluir, false)) AS pode_excluir
            FROM "condominio-bh".tb_sgw_perfil_menu
            WHERE id_perfil = :id_perfil
            GROUP BY id_menu
          ) pm
            ON pm.id_menu = m.id
          WHERE m.status = true
            AND EXISTS (
              SELECT 1
                FROM "condominio-bh".tb_sgw_perfil p
               WHERE p.id = :id_perfil
                 AND p.status = true
            )
          ORDER BY m.nivel ASC, m.ordem ASC, m.id ASC`,
        {
          replacements: {
            id_perfil: idPerfilToken
          },
          type: QueryTypes.SELECT
        }
      );

      const mapItens = new Map();

      for (const item of menus) {
        const idMenu = this._toInt(item.id, null);
        const idMenuPai = this._toInt(item.id_menu_pai, null);

        if (!idMenu) {
          continue;
        }

        mapItens.set(idMenu, {
          id: idMenu,
          nome: item.nome,
          rota: item.rota || null,
          icone: item.icone || null,
          nivel: this._toInt(item.nivel, 0),
          id_menu_pai: idMenuPai,
          ordem: this._toInt(item.ordem, 0),
          status: Boolean(item.status),
          pode_ver: Boolean(item.pode_ver),
          pode_criar: Boolean(item.pode_criar),
          pode_editar: Boolean(item.pode_editar),
          pode_excluir: Boolean(item.pode_excluir),
          itens: []
        });
      }

      const idsVisiveis = new Set();
      const idsVisiveisExplicitos = new Set();

      for (const item of mapItens.values()) {
        if (item.pode_ver) {
          idsVisiveis.add(item.id);
          idsVisiveisExplicitos.add(item.id);

          let idPai = this._toInt(item.id_menu_pai, null);
          while (idPai && mapItens.has(idPai) && !idsVisiveis.has(idPai)) {
            idsVisiveis.add(idPai);
            idPai = this._toInt(mapItens.get(idPai).id_menu_pai, null);
          }
        }
      }

      if (idsVisiveis.size === 0) {
        return res.status(200).json({
          total: 0,
          data: []
        });
      }

      const mapFiltrado = new Map();
      for (const idMenu of idsVisiveis.values()) {
        const item = mapItens.get(idMenu);
        if (!item) {
          continue;
        }

        mapFiltrado.set(idMenu, {
          ...item,
          // Todo item presente no payload final deve ser visível para o front.
          // Para nós herdados (pais), forçamos pode_ver=true para manter a árvore renderizável.
          pode_ver: true,
          pode_criar: idsVisiveisExplicitos.has(idMenu) ? item.pode_criar : false,
          pode_editar: idsVisiveisExplicitos.has(idMenu) ? item.pode_editar : false,
          pode_excluir: idsVisiveisExplicitos.has(idMenu) ? item.pode_excluir : false,
          permissao_herdada: !idsVisiveisExplicitos.has(idMenu),
          itens: []
        });
      }

      const raiz = [];

      for (const item of mapFiltrado.values()) {
        const idPai = this._toInt(item.id_menu_pai, null);
        const ehRaiz = !idPai || !mapFiltrado.has(idPai);

        if (ehRaiz) {
          raiz.push(item);
          continue;
        }

        mapFiltrado.get(idPai).itens.push(item);
      }

      const ordenarArvore = (lista) => {
        lista.sort((a, b) => {
          if (a.ordem !== b.ordem) {
            return a.ordem - b.ordem;
          }
          return a.id - b.id;
        });

        for (const item of lista) {
          if (item.itens.length > 0) {
            ordenarArvore(item.itens);
          }
        }
      };

      ordenarArvore(raiz);

      const contarItens = (lista) =>
        lista.reduce((acc, item) => acc + 1 + contarItens(item.itens || []), 0);

      const totalRetornado = contarItens(raiz);

      return res.status(200).json({
        total: totalRetornado,
        data: raiz
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar menu dinâmico.',
        detail: error.message
      });
    }
  }

  async listarDashboardTipos(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehMorador = idPerfilToken === 2;

      const status = true;
      const somenteAtivos = ['true', '1'].includes(String(status).trim().toLowerCase());

      const whereParts = ['1 = 1'];
      const replacements = {};

      if (somenteAtivos !== null) {
        whereParts.push('status = :status');
        replacements.status = somenteAtivos;
      }

      if (ehMorador) {
        whereParts.push('id = :id_tipo_ocorrencia');
        replacements.id_tipo_ocorrencia = 2;
      }

      const data = await postgres.query(
        `SELECT
            id,
            codigo,
            descricao,
            status,
            created_at
          FROM "condominio-bh".tb_dashboard_tipo
          WHERE ${whereParts.join(' AND ')}
          ORDER BY id ASC`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        total: data.length,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar tipos do dashboard.',
        detail: error.message
      });
    }
  }

  async listarDashboardEmpresas(req, res) {
    try {
      const tabelaExiste = await postgres.query(
        `SELECT EXISTS (
            SELECT 1
              FROM information_schema.tables
             WHERE table_schema = 'condominio-bh'
               AND table_name = 'tb_dashboard_empresas'
          ) AS existe`,
        {
          type: QueryTypes.SELECT
        }
      );

      if (!tabelaExiste[0]?.existe) {
        return res.status(200).json({
          total: 0,
          data: [],
          warning: 'Tabela tb_dashboard_empresas não encontrada no schema condominio-bh.'
        });
      }

      const data = await postgres.query(
        `SELECT
            id,
            empresa,
            status
          FROM "condominio-bh".tb_dashboard_empresas
          ORDER BY id ASC`,
        {
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        total: data.length,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar empresas do dashboard.',
        detail: error.message
      });
    }
  }

  async listarDashboardTitulos(req, res) {
    try {
      const data = await postgres.query(
        `SELECT
            id,
            titulo_descricao,
            status,
            id_tipo
          FROM "condominio-bh".tb_dashboard_titulo
          ORDER BY id ASC`,
        {
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        total: data.length,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar títulos do dashboard.',
        detail: error.message
      });
    }
  }

  async listarDashboardTitulosPorTipo(req, res) {
    try {
      const idTipo = this._toInt(req.params.id_tipo, null);
      if (!idTipo) {
        return res.status(400).json({
          message: 'Parâmetro id_tipo inválido.'
        });
      }

      const data = await postgres.query(
        `SELECT
            id,
            titulo_descricao,
            status,
            id_tipo
          FROM "condominio-bh".tb_dashboard_titulo
          WHERE id_tipo = :id_tipo
          ORDER BY id ASC`,
        {
          replacements: {
            id_tipo: idTipo
          },
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        total: data.length,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar títulos do dashboard por tipo.',
        detail: error.message
      });
    }
  }

  async buscarDashboardTipoPorId(req, res) {
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do tipo inválido.' });
      }

      const tipo = await postgres.query(
        `SELECT id, codigo, descricao, status, created_at
           FROM "condominio-bh".tb_dashboard_tipo
          WHERE id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT
        }
      );

      if (!tipo || tipo.length === 0) {
        return res.status(404).json({ message: 'Tipo de dashboard não encontrado.' });
      }

      return res.status(200).json({ data: tipo[0] });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar tipo do dashboard.',
        detail: error.message
      });
    }
  }

  async criarDashboardTipo(req, res) {
    try {
      const codigo = String(req.body.codigo || '').trim().toUpperCase();
      const descricao = String(req.body.descricao || '').trim();
      const status = req.body.status === undefined ? true : Boolean(req.body.status);

      const existente = await postgres.query(
        `SELECT id
           FROM "condominio-bh".tb_dashboard_tipo
          WHERE upper(codigo) = :codigo
          LIMIT 1`,
        {
          replacements: { codigo },
          type: QueryTypes.SELECT
        }
      );

      if (existente && existente.length > 0) {
        return res.status(409).json({ message: 'Já existe tipo de dashboard com esse código.' });
      }

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh".tb_dashboard_tipo (
            codigo,
            descricao,
            status,
            created_at
        ) VALUES (
            :codigo,
            :descricao,
            :status,
            now()
        )
        RETURNING id, codigo, descricao, status, created_at`,
        {
          replacements: {
            codigo,
            descricao,
            status
          }
        }
      );

      return res.status(201).json({
        message: 'Tipo de dashboard criado com sucesso.',
        data: insert[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao criar tipo do dashboard.',
        detail: error.message
      });
    }
  }

  async editarDashboardTipo(req, res) {
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do tipo inválido.' });
      }

      const tipoAtual = await postgres.query(
        `SELECT id, codigo, descricao, status
           FROM "condominio-bh".tb_dashboard_tipo
          WHERE id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT
        }
      );

      if (!tipoAtual || tipoAtual.length === 0) {
        return res.status(404).json({ message: 'Tipo de dashboard não encontrado.' });
      }

      const atual = tipoAtual[0];
      const codigo =
        req.body.codigo !== undefined ? String(req.body.codigo || '').trim().toUpperCase() : atual.codigo;
      const descricao =
        req.body.descricao !== undefined ? String(req.body.descricao || '').trim() : atual.descricao;
      const status = req.body.status !== undefined ? Boolean(req.body.status) : Boolean(atual.status);

      const existente = await postgres.query(
        `SELECT id
           FROM "condominio-bh".tb_dashboard_tipo
          WHERE upper(codigo) = :codigo
            AND id <> :id
          LIMIT 1`,
        {
          replacements: { codigo, id },
          type: QueryTypes.SELECT
        }
      );

      if (existente && existente.length > 0) {
        return res.status(409).json({ message: 'Já existe tipo de dashboard com esse código.' });
      }

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_dashboard_tipo
            SET codigo = :codigo,
                descricao = :descricao,
                status = :status
          WHERE id = :id
        RETURNING id, codigo, descricao, status, created_at`,
        {
          replacements: {
            id,
            codigo,
            descricao,
            status
          }
        }
      );

      return res.status(200).json({
        message: 'Tipo de dashboard atualizado com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao editar tipo do dashboard.',
        detail: error.message
      });
    }
  }

  async excluirDashboardTipo(req, res) {
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do tipo inválido.' });
      }

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_dashboard_tipo
            SET status = false
          WHERE id = :id
        RETURNING id, codigo, descricao, status, created_at`,
        {
          replacements: { id }
        }
      );

      if (!update[0] || update[0].length === 0) {
        return res.status(404).json({ message: 'Tipo de dashboard não encontrado.' });
      }

      return res.status(200).json({
        message: 'Tipo de dashboard desativado com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao desativar tipo do dashboard.',
        detail: error.message
      });
    }
  }

  async listarDashboardRegistros(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const ehAdmin = idPerfilToken === 1;
      const ehMorador = idPerfilToken === 2;

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;
      const exibicaoDashboard = this._toInt(req.query.exibicao_dashboard, null);
      const podeVerDashboardCondominial = ehMorador && exibicaoDashboard === 1;

      const whereParts = ['1 = 1'];
      const replacements = {};

      if (!ehAdmin) {
        if (!idCondominioToken) {
          return res.status(403).json({
            message: 'Token sem id_condominio para listar registros do dashboard.'
          });
        }

        whereParts.push('dr.id_condominio = :id_condominio_token');
        replacements.id_condominio_token = idCondominioToken;

        if (ehMorador && !podeVerDashboardCondominial) {
          if (!idUsuarioToken) {
            return res.status(403).json({
              message: 'Token sem id de usuário para listar registros do dashboard do morador.'
            });
          }

          whereParts.push('dr.id_usuario = :id_usuario_token');
          replacements.id_usuario_token = idUsuarioToken;
        }
      }

      const tipo = this._toInt(req.query.tipo, null);
      if (tipo !== null) {
        whereParts.push('dr.tipo = :tipo');
        replacements.tipo = tipo;
      }

      const statusFiltro = req.query.status !== undefined ? String(req.query.status).trim() : '';

      if (statusFiltro !== '') {
        whereParts.push('lower(dr.status) = :status');
        replacements.status = statusFiltro.toLowerCase();
      } else if (exibicaoDashboard === 1) {
        whereParts.push("lower(dr.status) = 'ativo'");
      } else if (ehMorador) {
        whereParts.push("lower(dr.status) IN ('ativo', 'inativo')");
      }

      if (exibicaoDashboard !== null) {
        whereParts.push('dr.exibicao_dashboard = :exibicao_dashboard');
        replacements.exibicao_dashboard = exibicaoDashboard;
      }

      if (req.query.origem !== undefined && String(req.query.origem).trim() !== '') {
        whereParts.push('dr.origem = :origem');
        replacements.origem = String(req.query.origem).trim();
      }

      const termoBuscaDashboard =
        req.query.q !== undefined && String(req.query.q).trim() !== ''
          ? String(req.query.q).trim()
          : req.query.titulo !== undefined && String(req.query.titulo).trim() !== ''
            ? String(req.query.titulo).trim()
            : null;

      if (termoBuscaDashboard) {
        whereParts.push('(dr.titulo ILIKE :q OR dr.descricao ILIKE :q)');
        replacements.q = `%${termoBuscaDashboard}%`;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_dashboard_registro dr
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            dr.id,
            dr.tipo,
            dt.codigo AS tipo_codigo,
            dt.descricao AS tipo_descricao,
            dr.titulo,
            dr.descricao,
            dr.status,
            dr.data_inicio,
            dr.data_fim,
            dr.data_referencia,
            dr.id_referencia,
            dr.origem,
            dr.prioridade,
            dr.exibicao_dashboard,
            dr.id_usuario,
            tu.nome AS usuario_nome,
            tu.sobrenome AS usuario_sobrenome,
            TRIM(COALESCE(tu.nome, '') || ' ' || COALESCE(tu.sobrenome, '')) AS usuario_nome_completo,
            COALESCE(dr.apartamento, tu.apartamento) AS apartamento,
            COALESCE(dr.bloco, tu.bloco) AS bloco,
            dr.empresa_entrega,
            de.empresa AS empresa_entrega_nome,
            dr.id_condominio,
            c.nome AS nome_condominio,
            c.escrita_bloco,
            c.qtde_ap_bloco,
            c.modelo_fatura,
            c.qtde_blocos,
            dr.origem,
            dr.created_at,
            dr.updated_at
          FROM "condominio-bh".tb_dashboard_registro dr
          LEFT JOIN "condominio-bh".tb_dashboard_tipo dt
             ON dt.id = dr.tipo
          LEFT JOIN "condominio-bh".tb_dashboard_empresas de
             ON de.id = CASE
               WHEN dr.empresa_entrega::text ~ '^[0-9]+$' THEN dr.empresa_entrega::int
               ELSE NULL
             END
           LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = dr.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" c
             ON c.id = dr.id_condominio
          WHERE ${whereClause}
          ORDER BY dr.prioridade DESC, dr.data_referencia DESC, dr.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...replacements,
            limit: pageSize,
            offset
          },
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      const dataComImagem = data.map((item) => ({
        ...item,
        imagem_url: buildDashboardImagemProxyUrl(req, item.id, item.origem)
      }));

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: dataComImagem
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar registros do dashboard.',
        detail: error.message
      });
    }
  }

  async buscarDashboardRegistroPorId(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const ehAdmin = idPerfilToken === 1;
      const ehMorador = idPerfilToken === 2;

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do registro inválido.' });
      }

      const whereParts = ['dr.id = :id'];
      const replacements = { id };

      if (!ehAdmin) {
        if (!idCondominioToken) {
          return res.status(403).json({
            message: 'Token sem id_condominio para buscar registro do dashboard.'
          });
        }

        whereParts.push('dr.id_condominio = :id_condominio_token');
        replacements.id_condominio_token = idCondominioToken;

        if (ehMorador) {
          if (!idUsuarioToken) {
            return res.status(403).json({
              message: 'Token sem id de usuário para buscar registro do dashboard do morador.'
            });
          }

          whereParts.push('dr.id_usuario = :id_usuario_token');
          replacements.id_usuario_token = idUsuarioToken;
        }
      }

      const registro = await postgres.query(
        `SELECT
            dr.id,
            dr.tipo,
            dt.codigo AS tipo_codigo,
            dt.descricao AS tipo_descricao,
            dr.titulo,
            dr.descricao,
            dr.status,
            dr.data_inicio,
            dr.data_fim,
            dr.data_referencia,
            dr.id_referencia,
            dr.origem,
            dr.prioridade,
            dr.exibicao_dashboard,
            dr.id_usuario,
            tu.nome AS usuario_nome,
            tu.sobrenome AS usuario_sobrenome,
            TRIM(COALESCE(tu.nome, '') || ' ' || COALESCE(tu.sobrenome, '')) AS usuario_nome_completo,
            COALESCE(dr.apartamento, tu.apartamento) AS apartamento,
            COALESCE(dr.bloco, tu.bloco) AS bloco,
            dr.empresa_entrega,
            de.empresa AS empresa_entrega_nome,
            dr.id_condominio,
            c.nome AS nome_condominio,
            c.escrita_bloco,
            c.qtde_ap_bloco,
            c.modelo_fatura,
            c.qtde_blocos,
            dr.origem,
            dr.created_at,
            dr.updated_at
          FROM "condominio-bh".tb_dashboard_registro dr
          LEFT JOIN "condominio-bh".tb_dashboard_tipo dt
             ON dt.id = dr.tipo
          LEFT JOIN "condominio-bh".tb_dashboard_empresas de
             ON de.id = CASE
               WHEN dr.empresa_entrega::text ~ '^[0-9]+$' THEN dr.empresa_entrega::int
               ELSE NULL
             END
           LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = dr.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" c
             ON c.id = dr.id_condominio
          WHERE ${whereParts.join(' AND ')}
          LIMIT 1`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      if (!registro || registro.length === 0) {
        return res.status(404).json({ message: 'Registro de dashboard não encontrado.' });
      }

      return res.status(200).json({
        data: {
          ...registro[0],
          imagem_url: buildDashboardImagemProxyUrl(req, registro[0].id, registro[0].origem)
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar registro do dashboard.',
        detail: error.message
      });
    }
  }

  async criarDashboardRegistro(req, res) {
    let transaction;
    try {
      transaction = await postgres.transaction();

      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const ehAdmin = idPerfilToken === 1;
      const ehMorador = idPerfilToken === 2;

      const idCondominioRequest = this._toInt(
        req.body.id_condominio !== undefined
          ? req.body.id_condominio
          : req.body.condominio_id !== undefined
            ? req.body.condominio_id
            : req.body.encomenda_condominio_id,
        null
      );

      const idCondominioFinal = ehAdmin ? idCondominioRequest : (idCondominioToken || idCondominioRequest);

      if (!idCondominioFinal) {
        return res.status(400).json({
          message: 'id_condominio não informado no token/body para criar registro do dashboard.'
        });
      }

      const idUsuarioFinal = ehMorador
        ? idUsuarioToken
        : this._toInt(req.body.id_usuario, idUsuarioToken);

      if (ehMorador && !idUsuarioFinal) {
        await transaction.rollback();
        return res.status(403).json({
          message: 'Token sem id de usuário para criar registro do dashboard do morador.'
        });
      }

      const apartamentoFinal =
        req.body.apartamento !== undefined
          ? String(req.body.apartamento || '').trim() || null
          : req.body.encomenda_apartamento !== undefined
            ? String(req.body.encomenda_apartamento || '').trim() || null
            : null;

      const blocoFinal =
        req.body.bloco !== undefined
          ? String(req.body.bloco || '').trim() || null
          : req.body.encomenda_bloco !== undefined
            ? String(req.body.encomenda_bloco || '').trim() || null
            : null;

      const empresaEntregaFinal =
        req.body.empresa_entrega !== undefined
          ? String(req.body.empresa_entrega || '').trim() || null
          : null;

      const tipoRegistro = this._toInt(req.body.tipo, 0);

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh".tb_dashboard_registro (
            tipo,
            titulo,
            descricao,
            status,
            data_inicio,
            data_fim,
            data_referencia,
            id_referencia,
            origem,
            prioridade,
            exibicao_dashboard,
            id_usuario,
            apartamento,
            bloco,
            empresa_entrega,
            id_condominio,
            created_at,
            updated_at
        ) VALUES (
            :tipo,
            :titulo,
            :descricao,
            :status,
            :data_inicio,
            :data_fim,
            :data_referencia,
            :id_referencia,
            :origem,
            :prioridade,
            :exibicao_dashboard,
            :id_usuario,
            :apartamento,
            :bloco,
            :empresa_entrega,
            :id_condominio,
            now(),
            now()
        )
        RETURNING *`,
        {
          replacements: {
            tipo: tipoRegistro,
            titulo: String(req.body.titulo || '').trim(),
            descricao: req.body.descricao ? String(req.body.descricao).trim() : null,
            status: req.body.status ? String(req.body.status).trim() : 'ativo',
            data_inicio: req.body.data_inicio || null,
            data_fim: req.body.data_fim || null,
            data_referencia: req.body.data_referencia || new Date(),
            id_referencia: this._toInt(req.body.id_referencia, null),
            origem: req.body.origem ? String(req.body.origem).trim() : null,
            prioridade: this._toInt(req.body.prioridade, 0),
            exibicao_dashboard: this._toInt(req.body.exibicao_dashboard, 1),
            id_usuario: idUsuarioFinal,
            apartamento: apartamentoFinal,
            bloco: blocoFinal,
            empresa_entrega: empresaEntregaFinal,
            id_condominio: idCondominioFinal
          },
          transaction
        }
      );

      const registroCriado = insert?.[0]?.[0];
      const idCodigoRegistro = this._toInt(registroCriado?.id, null);

      if (tipoRegistro === 3) {
        const tipoNotificacaoRows = await postgres.query(
          `SELECT id
           FROM "condominio-bh".tb_notificacao_tipo
          WHERE codigo::text = '8' OR id = 8
          ORDER BY CASE WHEN codigo::text = '8' THEN 0 ELSE 1 END
          LIMIT 1`,
          {
            type: QueryTypes.SELECT,
            transaction
          }
        );

        const idNotificacaoTipo = this._toInt(tipoNotificacaoRows?.[0]?.id, null);
        if (!idNotificacaoTipo) {
          throw new Error('Tipo de notificação 8 não encontrado na tb_notificacao_tipo.');
        }

        const idUsuarioPedidoInicial = this._toInt(
          registroCriado?.id_usuario ??
          req.body.id_usuario_pedido ??
          req.body.id_usuario_encomenda ??
          req.body.id_usuario_destino,
          null
        );

        const idsUsuariosDestino = new Set();
        if (idUsuarioPedidoInicial) {
          idsUsuariosDestino.add(idUsuarioPedidoInicial);
        }

        if (apartamentoFinal) {
          const usuarioPedidoRows = await postgres.query(
            `SELECT id
             FROM "condominio-bh"."tb-usuarios"
            WHERE id_condominio = :id_condominio
              AND COALESCE(apartamento, '') = :apartamento
              AND (:bloco IS NULL OR COALESCE(bloco, '') = :bloco)
            ORDER BY id DESC`,
            {
              replacements: {
                id_condominio: idCondominioFinal,
                apartamento: apartamentoFinal,
                bloco: blocoFinal
              },
              type: QueryTypes.SELECT,
              transaction
            }
          );

          for (const row of usuarioPedidoRows || []) {
            const idUsuarioMorador = this._toInt(row?.id, null);
            if (idUsuarioMorador) {
              idsUsuariosDestino.add(idUsuarioMorador);
            }
          }
        }

        const idUsuarioRegistrando = this._toInt(idUsuarioToken, null);
        if (!idUsuarioRegistrando) {
          throw new Error('Usuário do token não identificado para salvar notificação.');
        }

        let empresaEntregaMensagem = empresaEntregaFinal;
        if (empresaEntregaFinal && /^\d+$/.test(String(empresaEntregaFinal))) {
          const empresaRows = await postgres.query(
            `SELECT empresa
               FROM "condominio-bh".tb_dashboard_empresas
              WHERE id = :id
              LIMIT 1`,
            {
              replacements: {
                id: this._toInt(empresaEntregaFinal, null)
              },
              type: QueryTypes.SELECT,
              transaction
            }
          );

          const nomeEmpresa = this._normalizarTextoOuNull(empresaRows?.[0]?.empresa);
          if (nomeEmpresa) {
            empresaEntregaMensagem = nomeEmpresa;
          }
        }

        const mensagemNotificacao = [
          'Nova ocorrência registrada',
          apartamentoFinal ? `apto ${apartamentoFinal}` : null,
          blocoFinal ? `bloco ${blocoFinal}` : null,
          empresaEntregaMensagem ? `empresa ${empresaEntregaMensagem}` : null
        ]
          .filter((item) => item)
          .join(' - ');

        if (idsUsuariosDestino.size === 0) {
          throw new Error('Nenhum morador destinatário encontrado para salvar notificação.');
        }

        for (const idUsuarioDestino of idsUsuariosDestino) {
          await postgres.query(
            `INSERT INTO "condominio-bh".tb_notificacao_log (
              id_notificacao_tipo,
              id_usuario,
              mensagem,
              id_usuario_pedido,
              id_condominio,
              id_codigo
           ) VALUES (
              :id_notificacao_tipo,
              :id_usuario,
              :mensagem,
              :id_usuario_pedido,
              :id_condominio,
              :id_codigo
           )`,
            {
              replacements: {
                id_notificacao_tipo: idNotificacaoTipo,
                id_usuario: idUsuarioDestino,
                mensagem: mensagemNotificacao,
                id_usuario_pedido: idUsuarioRegistrando,
                id_condominio: idCondominioFinal,
                id_codigo: idCodigoRegistro
              },
              transaction
            }
          );
        }

        const resultadoPush = await pushNotificationService.enviarParaUsuarios(
          Array.from(idsUsuariosDestino),
          {
            title: '📦 Nova encomenda!',
            body: 'Seu pacote chegou na portaria.',
            sound: 'default',
            data: {
              tipo: 'encomenda',
              id: idCodigoRegistro,
              rota: '/encomendas'
            }
          }
        );

        if (resultadoPush?.invalid?.length > 0) {
          // Não interrompe o fluxo principal quando há token inválido.
          console.warn('[push][encomenda] tokens inválidos:', resultadoPush.invalid);
        }
      }

      await transaction.commit();

      // Email aos moradores do apartamento quando encomenda é registrada
      if (tipoRegistro === 3 && apartamentoFinal) {
        waitUntil((async () => {
          try {
            const moradores = await postgres.query(
              `SELECT tu.email
                 FROM "condominio-bh"."tb-usuarios" tu
                WHERE tu.id_condominio = :id_condominio
                  AND COALESCE(tu.apartamento, '') = :apartamento
                  AND (:bloco IS NULL OR COALESCE(tu.bloco, '') = :bloco)
                  AND tu.email IS NOT NULL AND tu.email <> ''
                  AND COALESCE(tu.status, '') IN ('ativo', 'Ativo')`,
              {
                replacements: { id_condominio: idCondominioFinal, apartamento: apartamentoFinal, bloco: blocoFinal },
                type: QueryTypes.SELECT
              }
            );

            const emailsMoradores = [...new Set(moradores.map((r) => r.email).filter(Boolean))];
            if (emailsMoradores.length === 0) return;

            const [condominioRow] = await postgres.query(
              `SELECT nome FROM "condominio-bh"."tb-condominios" WHERE id = :id LIMIT 1`,
              { replacements: { id: idCondominioFinal }, type: QueryTypes.SELECT }
            );

            await despacharEmailReserva({
              _id_agenda: registroCriado?.id,
              template: 'encomenda_notificacao',
              emails: emailsMoradores,
              encomenda: {
                apartamento: apartamentoFinal || '',
                bloco: blocoFinal || '',
                empresa_entrega: empresaEntregaFinal || '',
                titulo: String(registroCriado?.titulo || ''),
                condominio_nome: condominioRow?.nome || ''
              }
            });
          } catch (emailErr) {
            console.error('[emailDispatch] Erro encomenda:', emailErr?.message);
          }
        })());
      }

      const arquivoImagem =
        req.files?.imagem?.[0] ||
        req.files?.foto?.[0] ||
        req.files?.arquivo?.[0] ||
        req.file ||
        null;

      if (arquivoImagem?.buffer && idCodigoRegistro) {
        try {
          const urlImagem = await this._uploadImagemBlob(
            arquivoImagem,
            idCondominioFinal,
            `dashboard/registros/tipo${tipoRegistro}/${idCodigoRegistro}`,
            null
          );

          await postgres.query(
            `UPDATE "condominio-bh".tb_dashboard_registro
                SET origem = :origem,
                    updated_at = now()
              WHERE id = :id`,
            {
              replacements: { id: idCodigoRegistro, origem: urlImagem },
              type: QueryTypes.UPDATE
            }
          );

          registroCriado.origem = urlImagem;
        } catch (uploadError) {
          return res.status(500).json({
            message: 'Registro criado, mas falha ao salvar imagem.',
            detail: uploadError.message,
            data: registroCriado
          });
        }
      }

      return res.status(201).json({
        message: 'Registro de dashboard criado com sucesso.',
        data: registroCriado
      });
    } catch (error) {
      if (transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {
          // noop
        }
      }

      return res.status(500).json({
        message: 'Falha ao criar registro do dashboard.',
        detail: error.message
      });
    }
  }

  async editarDashboardRegistro(req, res) {
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do registro inválido.' });
      }

      const atualRows = await postgres.query(
        `SELECT *
           FROM "condominio-bh".tb_dashboard_registro
          WHERE id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT
        }
      );

      if (!atualRows || atualRows.length === 0) {
        return res.status(404).json({ message: 'Registro de dashboard não encontrado.' });
      }

      const atual = atualRows[0];

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_dashboard_registro
            SET tipo = :tipo,
                titulo = :titulo,
                descricao = :descricao,
                status = :status,
                data_inicio = :data_inicio,
                data_fim = :data_fim,
                data_referencia = :data_referencia,
                id_referencia = :id_referencia,
                origem = :origem,
                prioridade = :prioridade,
                exibicao_dashboard = :exibicao_dashboard,
                id_usuario = :id_usuario,
                apartamento = :apartamento,
                bloco = :bloco,
                empresa_entrega = :empresa_entrega,
                id_condominio = :id_condominio,
                updated_at = now()
          WHERE id = :id
        RETURNING *`,
        {
          replacements: {
            id,
            tipo: req.body.tipo !== undefined ? this._toInt(req.body.tipo, 0) : this._toInt(atual.tipo, 0),
            titulo: req.body.titulo !== undefined ? String(req.body.titulo || '').trim() : atual.titulo,
            descricao:
              req.body.descricao !== undefined ? (req.body.descricao ? String(req.body.descricao).trim() : null) : atual.descricao,
            status: req.body.status !== undefined ? String(req.body.status || 'ativo').trim() : atual.status,
            data_inicio: req.body.data_inicio !== undefined ? req.body.data_inicio || null : atual.data_inicio,
            data_fim: req.body.data_fim !== undefined ? req.body.data_fim || null : atual.data_fim,
            data_referencia:
              req.body.data_referencia !== undefined ? req.body.data_referencia || null : atual.data_referencia,
            id_referencia:
              req.body.id_referencia !== undefined
                ? this._toInt(req.body.id_referencia, null)
                : this._toInt(atual.id_referencia, null),
            origem: req.body.origem !== undefined ? (req.body.origem ? String(req.body.origem).trim() : null) : atual.origem,
            prioridade:
              req.body.prioridade !== undefined
                ? this._toInt(req.body.prioridade, 0)
                : this._toInt(atual.prioridade, 0),
            exibicao_dashboard:
              req.body.exibicao_dashboard !== undefined
                ? this._toInt(req.body.exibicao_dashboard, 1)
                : this._toInt(atual.exibicao_dashboard, 1),
            id_usuario: (() => {
              if (req.body.id_usuario === undefined || req.body.id_usuario === null || String(req.body.id_usuario).trim() === '') {
                return this._toInt(atual.id_usuario, null);
              }

              const idUsuarioBody = this._toInt(req.body.id_usuario, null);
              return idUsuarioBody || this._toInt(atual.id_usuario, null);
            })(),
            apartamento:
              req.body.apartamento !== undefined
                ? String(req.body.apartamento || '').trim() || null
                : req.body.encomenda_apartamento !== undefined
                  ? String(req.body.encomenda_apartamento || '').trim() || null
                  : atual.apartamento,
            bloco:
              req.body.bloco !== undefined
                ? String(req.body.bloco || '').trim() || null
                : req.body.encomenda_bloco !== undefined
                  ? String(req.body.encomenda_bloco || '').trim() || null
                  : atual.bloco,
            empresa_entrega:
              req.body.empresa_entrega !== undefined
                ? String(req.body.empresa_entrega || '').trim() || null
                : atual.empresa_entrega,
            id_condominio:
              req.body.id_condominio !== undefined ||
              req.body.condominio_id !== undefined ||
              req.body.encomenda_condominio_id !== undefined
                ? this._toInt(
                    req.body.id_condominio !== undefined
                      ? req.body.id_condominio
                      : req.body.condominio_id !== undefined
                        ? req.body.condominio_id
                        : req.body.encomenda_condominio_id,
                    null
                  )
                : this._toInt(atual.id_condominio, null)
          }
        }
      );

      const registroAtualizado = update[0][0];
      const idCondominioFinal = this._toInt(registroAtualizado?.id_condominio, null);
      const tipoFinal = this._toInt(registroAtualizado?.tipo ?? atual.tipo, 0);

      const arquivoImagem =
        req.files?.imagem?.[0] ||
        req.files?.foto?.[0] ||
        req.files?.arquivo?.[0] ||
        req.file ||
        null;

      if (arquivoImagem?.buffer && idCondominioFinal) {
        try {
          const urlImagem = await this._uploadImagemBlob(
            arquivoImagem,
            idCondominioFinal,
            `dashboard/registros/tipo${tipoFinal}/${id}`,
            atual.origem
          );

          await postgres.query(
            `UPDATE "condominio-bh".tb_dashboard_registro
                SET origem = :origem,
                    updated_at = now()
              WHERE id = :id`,
            {
              replacements: { id, origem: urlImagem },
              type: QueryTypes.UPDATE
            }
          );

          registroAtualizado.origem = urlImagem;
        } catch (uploadError) {
          return res.status(500).json({
            message: 'Registro atualizado, mas falha ao salvar imagem.',
            detail: uploadError.message,
            data: registroAtualizado
          });
        }
      }

      return res.status(200).json({
        message: 'Registro de dashboard atualizado com sucesso.',
        data: registroAtualizado
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao editar registro do dashboard.',
        detail: error.message
      });
    }
  }

  async buscarImagemDashboardRegistro(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Parâmetro id inválido.' });
      }

      const whereParts = ['id = :id'];
      const replacements = { id };

      if (!ehAdmin) {
        if (!idCondominioToken) {
          return res.status(403).json({ message: 'Token sem id_condominio.' });
        }
        whereParts.push('id_condominio = :id_condominio');
        replacements.id_condominio = idCondominioToken;
      }

      const rows = await postgres.query(
        `SELECT origem
           FROM "condominio-bh".tb_dashboard_registro
          WHERE ${whereParts.join(' AND ')}
          LIMIT 1`,
        { replacements, type: QueryTypes.SELECT }
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ message: 'Registro de dashboard não encontrado.' });
      }

      const origemImagem = this._normalizarTextoOuNull(rows[0].origem);
      if (!origemImagem) {
        return res.status(404).json({ message: 'Registro não possui imagem anexada.' });
      }

      const blobUrl = resolveBlobUrl(origemImagem);
      if (!blobUrl) {
        return res.status(500).json({ message: 'Falha ao resolver URL da imagem no blob.' });
      }

      const blobToken = getBlobReadToken();
      if (!blobToken) {
        return res.status(500).json({ message: 'Token do Vercel Blob não configurado para leitura.' });
      }

      const blobResponse = await fetch(blobUrl, {
        headers: { Authorization: `Bearer ${blobToken}` }
      });

      if (!blobResponse.ok) {
        if (blobResponse.status === 404) {
          return res.status(404).json({ message: 'Imagem não encontrada no blob.' });
        }
        return res.status(502).json({
          message: 'Falha ao ler imagem no blob.',
          detail: `Blob retornou status ${blobResponse.status}.`
        });
      }

      const payload = await blobResponse.buffer();
      const contentType = blobResponse.headers.get('content-type') || 'application/octet-stream';
      const cacheControl = blobResponse.headers.get('cache-control') || 'private, max-age=300';
      const etag = blobResponse.headers.get('etag');

      res.set('Content-Type', contentType);
      res.set('Cache-Control', cacheControl);
      if (etag) res.set('ETag', etag);

      return res.status(200).send(payload);
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar imagem do registro de dashboard.',
        detail: error.message
      });
    }
  }

  async excluirDashboardRegistro(req, res) {
    try {
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do registro inválido.' });
      }

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_dashboard_registro
            SET status = 'inativo',
                exibicao_dashboard = 0,
                updated_at = now()
          WHERE id = :id
        RETURNING *`,
        {
          replacements: { id }
        }
      );

      if (!update[0] || update[0].length === 0) {
        return res.status(404).json({ message: 'Registro de dashboard não encontrado.' });
      }

      return res.status(200).json({
        message: 'Registro de dashboard removido com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao remover registro do dashboard.',
        detail: error.message
      });
    }
  }

  async listarRelEnvioConfig(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let inviteContext = null;

      if (!idCondominioToken) {
        try {
          inviteContext = this._resolveInviteAuthContext(req);
        } catch (tokenError) {
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        if (inviteContext?.idCondominioInvite) {
          idCondominioToken = inviteContext.idCondominioInvite;
        }
      }

      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar configurações de envio.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (!ehAdmin && idCondominioFiltro && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para consultar configurações de outro condomínio.'
        });
      }

      if (
        inviteContext?.idCondominioInvite &&
        idCondominioFiltro &&
        idCondominioFiltro !== inviteContext.idCondominioInvite
      ) {
        return res.status(403).json({
          message: 'invite_token sem permissão para consultar outro condomínio.'
        });
      }

      const whereParts = ['1 = 1'];
      const replacements = {};

      const idCondominioFinal = idCondominioFiltro || (ehAdmin ? null : idCondominioToken);
      if (idCondominioFinal) {
        whereParts.push('rc.id_condominio = :id_condominio');
        replacements.id_condominio = idCondominioFinal;
      }

      if (req.query.ativo !== undefined && req.query.ativo !== null && String(req.query.ativo).trim() !== '') {
        const ativoRaw = String(req.query.ativo).trim().toLowerCase();
        const ativo = ['true', '1'].includes(ativoRaw);
        whereParts.push('COALESCE(rc.ativo, true) = :ativo');
        replacements.ativo = ativo;
      }

      const data = await postgres.query(
        `SELECT
            rc.id,
            rc.id_condominio,
            c.nome AS nome_condominio,
            rc.dia_envio,
            rc.horario_envio,
            rc.relatorio,
            COALESCE(rc.ativo, true) AS ativo,
            rc.criado_em
          FROM "condominio-bh".tb_sgw_rel_envio_config rc
          LEFT JOIN "condominio-bh"."tb-condominios" c
            ON c.id = rc.id_condominio
          WHERE ${whereParts.join(' AND ')}
          ORDER BY rc.id DESC`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const idsConfiguracao = data
        .map((item) => this._toInt(item?.id, null))
        .filter((item) => item !== null);

      const emailsPorConfig = new Map();
      const ultimosLogsPorConfig = new Map();

      if (idsConfiguracao.length > 0) {
        const logsRows = await postgres.query(
          `SELECT
              logs.id,
              logs.id_relatorio,
              logs.id_condominio,
              logs.data_envio,
              logs.status,
              logs.mensagem,
              rc.relatorio
            FROM (
              SELECT
                rl.id,
                rl.id_relatorio,
                rl.id_condominio,
                rl.data_envio,
                rl.status,
                rl.mensagem,
                ROW_NUMBER() OVER (
                  PARTITION BY rl.id_relatorio
                  ORDER BY rl.data_envio DESC, rl.id DESC
                ) AS row_num
              FROM "condominio-bh".tb_sgw_rel_envio_log rl
              WHERE rl.id_relatorio IN (:ids_rel_config)
            ) logs
            LEFT JOIN "condominio-bh".tb_sgw_rel_envio_config rc
              ON rc.id = logs.id_relatorio
            WHERE logs.row_num <= 3
            ORDER BY logs.id_relatorio ASC, logs.data_envio DESC, logs.id DESC`,
          {
            replacements: {
              ids_rel_config: idsConfiguracao
            },
            type: QueryTypes.SELECT
          }
        );

        for (const row of logsRows || []) {
          const idRelConfig = this._toInt(row?.id_relatorio, null);
          if (!idRelConfig) {
            continue;
          }

          const listaAtual = ultimosLogsPorConfig.get(idRelConfig) || [];
          listaAtual.push({
            id: this._toInt(row?.id, null),
            id_relatorio: idRelConfig,
            relatorio: this._normalizarTextoOuNull(row?.relatorio),
            id_condominio: this._toInt(row?.id_condominio, null),
            data_envio: row?.data_envio || null,
            status: this._normalizarTextoOuNull(row?.status),
            mensagem: this._normalizarTextoOuNull(row?.mensagem)
          });
          ultimosLogsPorConfig.set(idRelConfig, listaAtual);
        }

        const colunasRows = await postgres.query(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = 'condominio-bh'
              AND table_name = 'tb_sgw_rel_destinatario'`,
          {
            type: QueryTypes.SELECT
          }
        );

        const colunasTabela = new Set((colunasRows || []).map((item) => String(item.column_name || '').toLowerCase()));
        const colunaIdRelConfig = ['id_rel_config', 'id_relatorio_config', 'id_config_envio', 'id_envio_config']
          .find((item) => colunasTabela.has(item));
        const colunaEmail = ['email_destinatario', 'email', 'destinatario', 'email_to']
          .find((item) => colunasTabela.has(item));

        if (colunaIdRelConfig && colunaEmail) {
          const destinatariosRows = await postgres.query(
            `SELECT
                ${colunaIdRelConfig} AS id_rel_config,
                ${colunaEmail} AS email_destinatario
              FROM "condominio-bh".tb_sgw_rel_destinatario
              WHERE ${colunaIdRelConfig} IN (:ids_rel_config)`,
            {
              replacements: {
                ids_rel_config: idsConfiguracao
              },
              type: QueryTypes.SELECT
            }
          );

          for (const row of destinatariosRows || []) {
            const idRelConfig = this._toInt(row?.id_rel_config, null);
            const email = this._normalizarEmailOuNull(row?.email_destinatario);

            if (!idRelConfig || !email) {
              continue;
            }

            const listaAtual = emailsPorConfig.get(idRelConfig) || [];
            if (!listaAtual.includes(email)) {
              listaAtual.push(email);
            }
            emailsPorConfig.set(idRelConfig, listaAtual);
          }
        }
      }

      const dataComEmails = data.map((item) => {
        const idRelConfig = this._toInt(item?.id, null);
        return {
          ...item,
          emails_destinatarios: idRelConfig ? (emailsPorConfig.get(idRelConfig) || []) : [],
          ultimos_logs: idRelConfig ? (ultimosLogsPorConfig.get(idRelConfig) || []) : []
        };
      });

      return res.status(200).json({
        total: dataComEmails.length,
        data: dataComEmails
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar configurações de envio de relatório.',
        detail: error.message
      });
    }
  }

  async criarRelEnvioConfig(req, res) {
    const transaction = await postgres.transaction();
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let inviteContext = null;

      if (!idCondominioToken) {
        try {
          inviteContext = this._resolveInviteAuthContext(req);
        } catch (tokenError) {
          await transaction.rollback();
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        if (inviteContext?.idCondominioInvite) {
          idCondominioToken = inviteContext.idCondominioInvite;
        }
      }

      const ehAdmin = idPerfilToken === 1;

      const idCondominioPayload = this._toInt(req.body.id_condominio, null);

      if (
        inviteContext?.idCondominioInvite &&
        idCondominioPayload &&
        idCondominioPayload !== inviteContext.idCondominioInvite
      ) {
        await transaction.rollback();
        return res.status(403).json({
          message: 'invite_token sem permissão para criar configuração em outro condomínio.'
        });
      }

      const idCondominioFinal = ehAdmin ? idCondominioPayload : (idCondominioToken || idCondominioPayload);

      if (!idCondominioFinal) {
        await transaction.rollback();
        return res.status(400).json({
          message: 'id_condominio é obrigatório para criar configuração de envio.'
        });
      }

      if (!ehAdmin && idCondominioFinal !== idCondominioToken) {
        await transaction.rollback();
        return res.status(403).json({
          message: 'Sem permissão para criar configuração em outro condomínio.'
        });
      }

      const diaEnvio = this._toInt(req.body.dia_envio, null);
      const horarioEnvio = this._normalizarTextoOuNull(req.body.horario_envio);

      if (diaEnvio === null || diaEnvio < 1 || diaEnvio > 31) {
        await transaction.rollback();
        return res.status(400).json({
          message: 'Campo dia_envio deve ser numérico entre 1 e 31.'
        });
      }

      if (!horarioEnvio) {
        await transaction.rollback();
        return res.status(400).json({
          message: 'Campo horario_envio é obrigatório.'
        });
      }

      const emailsPayload = Array.isArray(req.body.emails_destinatarios)
        ? req.body.emails_destinatarios
        : [];

      const emailsDestinatarios = [...new Set(
        emailsPayload
          .map((email) => this._normalizarEmailOuNull(email))
          .filter((email) => Boolean(email))
      )];

      const created = await postgres.query(
        `INSERT INTO "condominio-bh".tb_sgw_rel_envio_config (
            id_condominio,
            dia_envio,
            horario_envio,
            ativo,
            relatorio,
            criado_em
          ) VALUES (
            :id_condominio,
            :dia_envio,
            :horario_envio::time,
            :ativo,
            :relatorio,
            now()
          )
          RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominioFinal,
            dia_envio: diaEnvio,
            horario_envio: horarioEnvio,
            ativo: req.body.ativo !== undefined ? Boolean(req.body.ativo) : true,
            relatorio: this._normalizarTextoOuNull(req.body.relatorio)
          },
          transaction
        }
      );

      const registroCriado = created?.[0]?.[0] || null;
      const idRelConfigCriado = this._toInt(registroCriado?.id, null);

      if (emailsDestinatarios.length > 0 && idRelConfigCriado) {
        const colunasRows = await postgres.query(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = 'condominio-bh'
              AND table_name = 'tb_sgw_rel_destinatario'`,
          {
            type: QueryTypes.SELECT,
            transaction
          }
        );

        const colunasTabela = new Set((colunasRows || []).map((item) => String(item.column_name || '').toLowerCase()));

        const colunaIdRelConfig = ['id_rel_config', 'id_relatorio_config', 'id_config_envio', 'id_envio_config']
          .find((item) => colunasTabela.has(item));
        const colunaEmail = ['email_destinatario', 'email', 'destinatario', 'email_to']
          .find((item) => colunasTabela.has(item));
        const colunaAtivo = colunasTabela.has('ativo') ? 'ativo' : null;
        const colunaCriadoEm = colunasTabela.has('criado_em') ? 'criado_em' : (colunasTabela.has('created_at') ? 'created_at' : null);
        const colunaIdCondominio = colunasTabela.has('id_condominio') ? 'id_condominio' : null;

        if (!colunaIdRelConfig || !colunaEmail) {
          throw new Error('Tabela tb_sgw_rel_destinatario sem colunas esperadas para vínculo e e-mail.');
        }

        for (const emailDestinatario of emailsDestinatarios) {
          const colunasInsert = [colunaIdRelConfig, colunaEmail];
          const valoresInsert = [':id_rel_config', ':email_destinatario'];
          const replacementsInsert = {
            id_rel_config: idRelConfigCriado,
            email_destinatario: emailDestinatario
          };

          if (colunaAtivo) {
            colunasInsert.push(colunaAtivo);
            valoresInsert.push(':ativo');
            replacementsInsert.ativo = true;
          }

          if (colunaIdCondominio) {
            colunasInsert.push(colunaIdCondominio);
            valoresInsert.push(':id_condominio');
            replacementsInsert.id_condominio = idCondominioFinal;
          }

          if (colunaCriadoEm) {
            colunasInsert.push(colunaCriadoEm);
            valoresInsert.push('now()');
          }

          await postgres.query(
            `INSERT INTO "condominio-bh".tb_sgw_rel_destinatario (
              ${colunasInsert.join(', ')}
            ) VALUES (
              ${valoresInsert.join(', ')}
            )`,
            {
              replacements: replacementsInsert,
              transaction
            }
          );
        }
      }

      await transaction.commit();

      return res.status(201).json({
        message: 'Configuração de envio criada com sucesso.',
        data: registroCriado,
        emails_destinatarios: emailsDestinatarios
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({
        message: 'Falha ao criar configuração de envio de relatório.',
        detail: error.message
      });
    }
  }

  async atualizarRelEnvioConfig(req, res) {
    const transaction = await postgres.transaction();
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let inviteContext = null;

      if (!idCondominioToken) {
        try {
          inviteContext = this._resolveInviteAuthContext(req);
        } catch (tokenError) {
          await transaction.rollback();
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        if (inviteContext?.idCondominioInvite) {
          idCondominioToken = inviteContext.idCondominioInvite;
        }
      }

      const ehAdmin = idPerfilToken === 1;

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Parâmetro id inválido.' });
      }

      const atualRows = await postgres.query(
        `SELECT *
           FROM "condominio-bh".tb_sgw_rel_envio_config
          WHERE id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT,
          transaction
        }
      );

      if (!atualRows || atualRows.length === 0) {
        return res.status(404).json({ message: 'Configuração de envio não encontrada.' });
      }

      const atual = atualRows[0];
      const idCondominioAtual = this._toInt(atual.id_condominio, null);

      if (!ehAdmin && (!idCondominioToken || idCondominioAtual !== idCondominioToken)) {
        return res.status(403).json({
          message: 'Sem permissão para atualizar configuração de outro condomínio.'
        });
      }

      if (
        inviteContext?.idCondominioInvite &&
        idCondominioAtual !== inviteContext.idCondominioInvite
      ) {
        return res.status(403).json({
          message: 'invite_token sem permissão para atualizar configuração de outro condomínio.'
        });
      }

      const diaEnvio =
        req.body.dia_envio !== undefined ? this._toInt(req.body.dia_envio, null) : this._toInt(atual.dia_envio, null);
      if (diaEnvio === null || diaEnvio < 1 || diaEnvio > 31) {
        return res.status(400).json({
          message: 'Campo dia_envio deve ser numérico entre 1 e 31.'
        });
      }

      const horarioEnvio =
        req.body.horario_envio !== undefined
          ? this._normalizarTextoOuNull(req.body.horario_envio)
          : this._normalizarTextoOuNull(atual.horario_envio);

      if (!horarioEnvio) {
        return res.status(400).json({
          message: 'Campo horario_envio é obrigatório.'
        });
      }

      const updated = await postgres.query(
        `UPDATE "condominio-bh".tb_sgw_rel_envio_config
            SET dia_envio = :dia_envio,
                horario_envio = :horario_envio::time,
                relatorio = :relatorio,
                ativo = :ativo
          WHERE id = :id
          RETURNING *`,
        {
          replacements: {
            id,
            dia_envio: diaEnvio,
            horario_envio: horarioEnvio,
            relatorio:
              req.body.relatorio !== undefined
                ? this._normalizarTextoOuNull(req.body.relatorio)
                : this._normalizarTextoOuNull(atual.relatorio),
            ativo: req.body.ativo !== undefined ? Boolean(req.body.ativo) : Boolean(atual.ativo)
          },
          transaction
        }
      );

      const emailsForamInformados = req.body.emails_destinatarios !== undefined;
      let emailsDestinatarios = null;

      if (emailsForamInformados) {
        const emailsPayload = Array.isArray(req.body.emails_destinatarios)
          ? req.body.emails_destinatarios
          : [];

        emailsDestinatarios = [...new Set(
          emailsPayload
            .map((email) => this._normalizarEmailOuNull(email))
            .filter((email) => Boolean(email))
        )];

        const colunasRows = await postgres.query(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = 'condominio-bh'
              AND table_name = 'tb_sgw_rel_destinatario'`,
          {
            type: QueryTypes.SELECT,
            transaction
          }
        );

        const colunasTabela = new Set((colunasRows || []).map((item) => String(item.column_name || '').toLowerCase()));

        const colunaIdRelConfig = ['id_rel_config', 'id_relatorio_config', 'id_config_envio', 'id_envio_config']
          .find((item) => colunasTabela.has(item));
        const colunaEmail = ['email_destinatario', 'email', 'destinatario', 'email_to']
          .find((item) => colunasTabela.has(item));
        const colunaAtivo = colunasTabela.has('ativo') ? 'ativo' : null;
        const colunaCriadoEm = colunasTabela.has('criado_em') ? 'criado_em' : (colunasTabela.has('created_at') ? 'created_at' : null);
        const colunaIdCondominio = colunasTabela.has('id_condominio') ? 'id_condominio' : null;

        if (!colunaIdRelConfig || !colunaEmail) {
          throw new Error('Tabela tb_sgw_rel_destinatario sem colunas esperadas para vínculo e e-mail.');
        }

        await postgres.query(
          `DELETE FROM "condominio-bh".tb_sgw_rel_destinatario
            WHERE ${colunaIdRelConfig} = :id_rel_config`,
          {
            replacements: {
              id_rel_config: id
            },
            type: QueryTypes.DELETE,
            transaction
          }
        );

        for (const emailDestinatario of emailsDestinatarios) {
          const colunasInsert = [colunaIdRelConfig, colunaEmail];
          const valoresInsert = [':id_rel_config', ':email_destinatario'];
          const replacementsInsert = {
            id_rel_config: id,
            email_destinatario: emailDestinatario
          };

          if (colunaAtivo) {
            colunasInsert.push(colunaAtivo);
            valoresInsert.push(':ativo');
            replacementsInsert.ativo = true;
          }

          if (colunaIdCondominio) {
            colunasInsert.push(colunaIdCondominio);
            valoresInsert.push(':id_condominio');
            replacementsInsert.id_condominio = idCondominioAtual;
          }

          if (colunaCriadoEm) {
            colunasInsert.push(colunaCriadoEm);
            valoresInsert.push('now()');
          }

          await postgres.query(
            `INSERT INTO "condominio-bh".tb_sgw_rel_destinatario (
              ${colunasInsert.join(', ')}
            ) VALUES (
              ${valoresInsert.join(', ')}
            )`,
            {
              replacements: replacementsInsert,
              transaction
            }
          );
        }
      }

      await transaction.commit();

      return res.status(200).json({
        message: 'Configuração de envio atualizada com sucesso.',
        data: updated[0][0],
        emails_destinatarios: emailsDestinatarios
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({
        message: 'Falha ao atualizar configuração de envio de relatório.',
        detail: error.message
      });
    }
  }

  async excluirRelEnvioConfig(req, res) {
    const transaction = await postgres.transaction();
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let inviteContext = null;

      if (!idCondominioToken) {
        try {
          inviteContext = this._resolveInviteAuthContext(req);
        } catch (tokenError) {
          await transaction.rollback();
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        if (inviteContext?.idCondominioInvite) {
          idCondominioToken = inviteContext.idCondominioInvite;
        }
      }

      const ehAdmin = idPerfilToken === 1;

      const id = this._toInt(req.params.id, null);
      if (!id) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Parâmetro id inválido.' });
      }

      const atualRows = await postgres.query(
        `SELECT id, id_condominio
           FROM "condominio-bh".tb_sgw_rel_envio_config
          WHERE id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT,
          transaction
        }
      );

      if (!atualRows || atualRows.length === 0) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Configuração de envio não encontrada.' });
      }

      const idCondominioAtual = this._toInt(atualRows[0].id_condominio, null);
      if (!ehAdmin && (!idCondominioToken || idCondominioAtual !== idCondominioToken)) {
        await transaction.rollback();
        return res.status(403).json({
          message: 'Sem permissão para excluir configuração de outro condomínio.'
        });
      }

      if (
        inviteContext?.idCondominioInvite &&
        idCondominioAtual !== inviteContext.idCondominioInvite
      ) {
        await transaction.rollback();
        return res.status(403).json({
          message: 'invite_token sem permissão para excluir configuração de outro condomínio.'
        });
      }

      const colunasRows = await postgres.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'condominio-bh'
            AND table_name = 'tb_sgw_rel_destinatario'`,
        {
          type: QueryTypes.SELECT,
          transaction
        }
      );

      const colunasTabela = new Set((colunasRows || []).map((item) => String(item.column_name || '').toLowerCase()));
      const colunaIdRelConfig = ['id_rel_config', 'id_relatorio_config', 'id_config_envio', 'id_envio_config']
        .find((item) => colunasTabela.has(item));

      if (colunaIdRelConfig) {
        await postgres.query(
          `DELETE FROM "condominio-bh".tb_sgw_rel_destinatario
            WHERE ${colunaIdRelConfig} = :id_rel_config`,
          {
            replacements: {
              id_rel_config: id
            },
            type: QueryTypes.DELETE,
            transaction
          }
        );
      }

      await postgres.query(
        `DELETE FROM "condominio-bh".tb_sgw_rel_envio_config
          WHERE id = :id`,
        {
          replacements: { id },
          type: QueryTypes.DELETE,
          transaction
        }
      );

      await transaction.commit();

      return res.status(200).json({
        message: 'Configuração de envio excluída com sucesso.'
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({
        message: 'Falha ao excluir configuração de envio de relatório.',
        detail: error.message
      });
    }
  }

  async listarRelEnvioLog(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let inviteContext = null;

      if (!idCondominioToken) {
        try {
          inviteContext = this._resolveInviteAuthContext(req);
        } catch (tokenError) {
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        if (inviteContext?.idCondominioInvite) {
          idCondominioToken = inviteContext.idCondominioInvite;
        }
      }

      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar logs de envio.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (!ehAdmin && idCondominioFiltro && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para consultar logs de outro condomínio.'
        });
      }

      if (
        inviteContext?.idCondominioInvite &&
        idCondominioFiltro &&
        idCondominioFiltro !== inviteContext.idCondominioInvite
      ) {
        return res.status(403).json({
          message: 'invite_token sem permissão para consultar logs de outro condomínio.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const whereParts = ['1 = 1'];
      const replacements = {
        limit: pageSize,
        offset
      };

      const idCondominioFinal = idCondominioFiltro || (ehAdmin ? null : idCondominioToken);
      if (idCondominioFinal) {
        whereParts.push('rl.id_condominio = :id_condominio');
        replacements.id_condominio = idCondominioFinal;
      }

      const idRelatorioFiltro = this._toInt(req.query.id_relatorio, null);
      if (idRelatorioFiltro) {
        whereParts.push('rl.id_relatorio = :id_relatorio');
        replacements.id_relatorio = idRelatorioFiltro;
      }

      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      if (statusFiltro) {
        whereParts.push("lower(COALESCE(rl.status, '')) = :status");
        replacements.status = String(statusFiltro).toLowerCase();
      }

      const dataInicio =
        this._normalizarTextoOuNull(req.query.data_inicio) ||
        this._normalizarTextoOuNull(req.query.periodo_inicio);
      if (dataInicio) {
        whereParts.push('rl.data_envio >= :data_inicio::timestamp');
        replacements.data_inicio = dataInicio;
      }

      const dataFim =
        this._normalizarTextoOuNull(req.query.data_fim) ||
        this._normalizarTextoOuNull(req.query.periodo_fim);
      if (dataFim) {
        whereParts.push('rl.data_envio < (:data_fim::date + interval \'1 day\')');
        replacements.data_fim = dataFim;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(1)::int AS total
           FROM "condominio-bh".tb_sgw_rel_envio_log rl
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            rl.id,
            rl.id_condominio,
            c.nome AS nome_condominio,
            rl.id_relatorio,
            rc.relatorio AS nome_relatorio,
            rl.data_envio,
            rl.status,
            rl.mensagem
          FROM "condominio-bh".tb_sgw_rel_envio_log rl
          LEFT JOIN "condominio-bh"."tb-condominios" c
            ON c.id = rl.id_condominio
          LEFT JOIN "condominio-bh".tb_sgw_rel_envio_config rc
            ON rc.id = rl.id_relatorio
          WHERE ${whereClause}
          ORDER BY rl.data_envio DESC, rl.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        filtros: {
          id_condominio: idCondominioFinal,
          id_relatorio: idRelatorioFiltro,
          status: statusFiltro,
          data_inicio: dataInicio,
          data_fim: dataFim
        },
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar logs de envio de relatório.',
        detail: error.message
      });
    }
  }

  async criarRelEnvioLog(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let inviteContext = null;

      if (!idCondominioToken) {
        try {
          inviteContext = this._resolveInviteAuthContext(req);
        } catch (tokenError) {
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        if (inviteContext?.idCondominioInvite) {
          idCondominioToken = inviteContext.idCondominioInvite;
        }
      }

      const ehAdmin = idPerfilToken === 1;

      const idCondominioPayload = this._toInt(req.body.id_condominio, null);

      if (
        inviteContext?.idCondominioInvite &&
        idCondominioPayload &&
        idCondominioPayload !== inviteContext.idCondominioInvite
      ) {
        return res.status(403).json({
          message: 'invite_token sem permissão para registrar log em outro condomínio.'
        });
      }

      const idCondominioFinal = ehAdmin ? idCondominioPayload : (idCondominioToken || idCondominioPayload);

      if (!idCondominioFinal) {
        return res.status(400).json({
          message: 'id_condominio é obrigatório para registrar log de envio.'
        });
      }

      if (!ehAdmin && idCondominioFinal !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para registrar log em outro condomínio.'
        });
      }

      const idRelatorio = this._toInt(req.body.id_relatorio, null);
      const status = this._normalizarTextoOuNull(req.body.status);
      const mensagem = this._normalizarTextoOuNull(req.body.mensagem);
      const dataEnvio = this._normalizarTextoOuNull(req.body.data_envio);

      const created = await postgres.query(
        `INSERT INTO "condominio-bh".tb_sgw_rel_envio_log (
            id_condominio,
            id_relatorio,
            data_envio,
            status,
            mensagem
          ) VALUES (
            :id_condominio,
            :id_relatorio,
            COALESCE(:data_envio::timestamp, now()),
            :status,
            :mensagem
          )
          RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominioFinal,
            id_relatorio: idRelatorio,
            data_envio: dataEnvio,
            status,
            mensagem
          }
        }
      );

      return res.status(201).json({
        message: 'Log de envio registrado com sucesso.',
        data: created[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao registrar log de envio de relatório.',
        detail: error.message
      });
    }
  }

  async listarMoradores(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar moradores.'
        });
      }

      const replacementsBase = {
        eh_admin: ehAdmin,
        id_condominio: idCondominioToken
      };

      const nomeFiltro = this._normalizarTextoOuNull(req.query.nome);
      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      const tipoMoradorFiltro = this._normalizarTextoOuNull(req.query.tipo_morador);
      const ativoQuery = req.query.ativo;
      let ativoFiltro = null;
      if (ativoQuery !== undefined && ativoQuery !== null && String(ativoQuery).trim() !== '') {
        const ativoNormalizado = String(ativoQuery).trim().toLowerCase();
        if (['true', '1'].includes(ativoNormalizado)) {
          ativoFiltro = true;
        } else if (['false', '0'].includes(ativoNormalizado)) {
          ativoFiltro = false;
        }
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = [
        `(
          :eh_admin = true
          OR (
            tu.id_condominio = :id_condominio
            AND COALESCE(tu.tipo_perfil_id::text, '0') <> '1'
          )
        )`
      ];

      if (nomeFiltro) {
        whereParts.push(`(
          tu.nome ILIKE :nome
          OR tu.sobrenome ILIKE :nome
          OR TRIM(COALESCE(tu.nome, '') || ' ' || COALESCE(tu.sobrenome, '')) ILIKE :nome
        )`);
        replacementsBase.nome = `%${nomeFiltro}%`;
      }

      if (statusFiltro) {
        whereParts.push("lower(COALESCE(tu.status, '')) = :status");
        replacementsBase.status = String(statusFiltro).toLowerCase();
      }

      if (tipoMoradorFiltro) {
        whereParts.push("lower(COALESCE(tu.tipo_morador, '')) = :tipo_morador");
        replacementsBase.tipo_morador = String(tipoMoradorFiltro).toLowerCase();
      }

      if (ativoFiltro === true) {
        whereParts.push("lower(COALESCE(tu.status, '')) = :status_ativo");
        replacementsBase.status_ativo = 'ativo';
      } else if (ativoFiltro === false) {
        whereParts.push("lower(COALESCE(tu.status, '')) <> :status_ativo");
        replacementsBase.status_ativo = 'ativo';
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh"."tb-usuarios" tu
          WHERE ${whereClause}`,
        {
          replacements: replacementsBase,
          type: QueryTypes.SELECT
        }
      );

      const rows = await postgres.query(
        `SELECT
            tu.id,
            tu.id_condominio,
            tc.nome AS nome_condominio,
            tc.escrita_bloco,
            tc.qtde_ap_bloco,
            tc.modelo_fatura,
            tc.qtde_blocos,
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.telefone,
          tu.path_avatar,
            tu.tipo_morador,
            tu.tipo_perfil_id,
            tu.tipo,
            tu.status,
            tu.apartamento,
            tu.bloco,
            tu.created_at,
            tu.updated_at,
            (
              SELECT r.id
                FROM "condominio-bh".tb_regulamento r
               WHERE r.id_condominio = tu.id_condominio
                 AND r.ativo = true
               ORDER BY r.publicado_em DESC, r.id DESC
               LIMIT 1
            ) AS id_regulamento_ativo,
            CASE
              WHEN (
                SELECT MAX(a.aceito_em)
                  FROM "condominio-bh".tb_regulamento_aceite a
                 WHERE a.id_usuario = tu.id
                   AND a.id_regulamento = (
                     SELECT r2.id
                       FROM "condominio-bh".tb_regulamento r2
                      WHERE r2.id_condominio = tu.id_condominio
                        AND r2.ativo = true
                      ORDER BY r2.publicado_em DESC, r2.id DESC
                      LIMIT 1
                   )
              ) IS NOT NULL THEN true ELSE false END AS aceitou_regulamento_ativo,
            (
              SELECT MAX(a.aceito_em)
                FROM "condominio-bh".tb_regulamento_aceite a
               WHERE a.id_usuario = tu.id
                 AND a.id_regulamento = (
                   SELECT r3.id
                     FROM "condominio-bh".tb_regulamento r3
                    WHERE r3.id_condominio = tu.id_condominio
                      AND r3.ativo = true
                    ORDER BY r3.publicado_em DESC, r3.id DESC
                    LIMIT 1
                 )
            ) AS aceite_regulamento_ativo_em
          FROM "condominio-bh"."tb-usuarios" tu
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = tu.id_condominio
          WHERE ${whereClause}
          ORDER BY tu.nome ASC, tu.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...replacementsBase,
            limit: pageSize,
            offset
          },
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: this._anexarAvatarUrlUsuarios(req, rows)
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao listar moradores no PostgreSQL',
        detail: error.message
      });
    }
  }

  async consultarUsuariosBase(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          success: false,
          message: 'Token sem id_condominio para consultar usuários.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      const blocoFiltro = this._normalizarTextoOuNull(req.query.bloco);
      const apartamentoFiltro = this._normalizarTextoOuNull(req.query.apartamento);

      if (!ehAdmin && idCondominioFiltro && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          success: false,
          message: 'Sem permissão para consultar usuários de outro condomínio.'
        });
      }

      const replacements = {
        eh_admin: ehAdmin,
        id_condominio_token: idCondominioToken
      };

      const whereParts = [
        '(:eh_admin = true OR tu.id_condominio = :id_condominio_token)'
      ];

      if (idCondominioFiltro) {
        whereParts.push('tu.id_condominio = :id_condominio_filtro');
        replacements.id_condominio_filtro = idCondominioFiltro;
      }

      if (blocoFiltro) {
        whereParts.push("lower(COALESCE(tu.bloco, '')) = :bloco");
        replacements.bloco = String(blocoFiltro).toLowerCase();
      }

      if (apartamentoFiltro) {
        whereParts.push("lower(COALESCE(tu.apartamento, '')) = :apartamento");
        replacements.apartamento = String(apartamentoFiltro).toLowerCase();
      }

      const whereClause = whereParts.join(' AND ');

      const usuarios = await postgres.query(
        `SELECT
            tu.id,
            tu.id_condominio,
            tc.nome AS nome_condominio,
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.telefone,
            tu.path_avatar,
            tu.tipo_morador,
            tu.tipo_perfil_id,
            tu.tipo,
            tu.status,
            tu.data_nascimento,
            tu.genero,
            tu.endereco_logradouro,
            tu.endereco_numero,
            tu.endereco_complemento,
            tu.endereco_bairro,
            tu.endereco_cidade,
            tu.endereco_uf,
            tu.endereco_cep,
            tu.apartamento,
            tu.bloco,
            tu.observacoes,
            tu.last_login_at,
            tu.created_at,
            tu.updated_at
          FROM "condominio-bh"."tb-usuarios" tu
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = tu.id_condominio
          WHERE ${whereClause}
          ORDER BY tu.id DESC`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      return res.status(200).json({
        success: true,
        total: usuarios.length,
        filtros: {
          id_condominio: idCondominioFiltro || (ehAdmin ? null : idCondominioToken),
          bloco: blocoFiltro,
          apartamento: apartamentoFiltro
        },
        data: this._anexarAvatarUrlUsuarios(req, usuarios)
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Falha ao consultar usuários da base.',
        detail: error.message
      });
    }
  }

  async relatorioUsuarios(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar relatório de usuários.'
        });
      }

      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      const tipoMoradorFiltro = this._normalizarTextoOuNull(req.query.tipo_morador);
      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const replacements = {
        eh_admin: ehAdmin,
        id_condominio_token: idCondominioToken,
        limit: pageSize,
        offset
      };

      const whereParts = [
        `(
          :eh_admin = true
          OR (
            tu.id_condominio = :id_condominio_token
            AND COALESCE(tu.tipo_perfil_id::text, '0') <> '1'
          )
        )`
      ];

      if (statusFiltro) {
        if (/^\d+$/.test(String(statusFiltro))) {
          const statusCode = this._toInt(statusFiltro, null);
          if (statusCode === 1) {
            whereParts.push("lower(COALESCE(tu.status, '')) = :status_ativo");
            replacements.status_ativo = 'ativo';
          } else if (statusCode === 0) {
            whereParts.push("lower(COALESCE(tu.status, '')) = :status_inativo");
            replacements.status_inativo = 'inativo';
          }
          // statusCode 2 (todos) não aplica filtro adicional.
        } else {
          whereParts.push("lower(COALESCE(tu.status, '')) = :status");
          replacements.status = String(statusFiltro).toLowerCase();
        }
      }

      if (tipoMoradorFiltro) {
        whereParts.push("lower(COALESCE(tu.tipo_morador, '')) = :tipo_morador");
        replacements.tipo_morador = String(tipoMoradorFiltro).toLowerCase();
      }

      if (idCondominioFiltro) {
        if (!ehAdmin && idCondominioFiltro !== idCondominioToken) {
          return res.status(403).json({
            message: 'Sem permissão para consultar relatório de outro condomínio.'
          });
        }

        whereParts.push('tu.id_condominio = :id_condominio_filtro');
        replacements.id_condominio_filtro = idCondominioFiltro;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh"."tb-usuarios" tu
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const rows = await postgres.query(
        `SELECT
            tc.nome AS nome_condominio,
            tu.bloco,
            tu.apartamento,
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.telefone,
            tu.tipo_morador,
            tu.tipo,
            tu.status
          FROM "condominio-bh"."tb-usuarios" tu
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = tu.id_condominio
          WHERE ${whereClause}
          ORDER BY tc.nome ASC, tu.nome ASC, tu.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: rows
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao gerar relatório de usuários no PostgreSQL',
        detail: error.message
      });
    }
  }

  async relatorioConsumo(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar relatório de consumo.'
        });
      }

      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      const periodoInicio = this._normalizarTextoOuNull(req.query.periodo_inicio) || this._normalizarTextoOuNull(req.query.periodoInicio);
      const periodoFim = this._normalizarTextoOuNull(req.query.periodo_fim) || this._normalizarTextoOuNull(req.query.periodoFim);
      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      const idTipoConsumoFiltro = this._toInt(req.query.id_tipo_consumo, null);

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 500);
      const offset = (page - 1) * pageSize;

      const replacements = {
        eh_admin: ehAdmin,
        id_condominio_token: idCondominioToken,
        limit: pageSize,
        offset
      };

      const whereParts = [
        `(
          :eh_admin = true
          OR cr.id_condominio = :id_condominio_token
        )`
      ];

      if (idCondominioFiltro) {
        if (!ehAdmin && idCondominioFiltro !== idCondominioToken) {
          return res.status(403).json({
            message: 'Sem permissão para consultar relatório de consumo de outro condomínio.'
          });
        }

        whereParts.push('cr.id_condominio = :id_condominio_filtro');
        replacements.id_condominio_filtro = idCondominioFiltro;
      }

      if (periodoInicio) {
        whereParts.push('cr.competencia >= :periodo_inicio::date');
        replacements.periodo_inicio = periodoInicio;
      }

      if (periodoFim) {
        whereParts.push("cr.competencia < (:periodo_fim::date + INTERVAL '1 day')");
        replacements.periodo_fim = periodoFim;
      }

      if (idTipoConsumoFiltro) {
        whereParts.push('cr.id_tipo_consumo = :id_tipo_consumo');
        replacements.id_tipo_consumo = idTipoConsumoFiltro;
      }

      if (statusFiltro) {
        if (/^\d+$/.test(String(statusFiltro))) {
          const statusCode = this._toInt(statusFiltro, null);
          if (statusCode === 1) {
            whereParts.push("lower(COALESCE(cr.status, '')) = :status_ativo");
            replacements.status_ativo = 'ativo';
          } else if (statusCode === 0) {
            whereParts.push("lower(COALESCE(cr.status, '')) = :status_inativo");
            replacements.status_inativo = 'inativo';
          }
          // statusCode 2 (todos) não aplica filtro adicional.
        } else {
          whereParts.push("lower(COALESCE(cr.status, '')) = :status");
          replacements.status = String(statusFiltro).toLowerCase();
        }
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_consumo_registros cr
          LEFT JOIN "condominio-bh".tb_consumo_tipo ct
            ON ct.id = cr.id_tipo_consumo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = cr.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = cr.id_condominio
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const rows = await postgres.query(
        `SELECT
            cr.id,
            cr.id_tipo_consumo,
            ct.nome AS tipo_consumo,
            cr.created_at AS data_cadastro,
            cr.leitura_anterior AS leitura_inicial,
            cr.leitura_atual AS leitura_final,
            cr.competencia AS mes_consumo,
            cr.valor_unitario AS tarifa_cobranca,
            cr.valor_total AS valor_total_calculado,
            cr.observacao,
            cr.status,
            tc.nome AS nome_condominio,
            tc.cnpj AS cnpj_condominio,
            tc.email AS email_condominio,
            tu.nome || ' ' || tu.sobrenome AS nome_morador,
            tu.sobrenome AS sobrenome_morador,
            tu.bloco as torre,
            tu.apartamento
          FROM "condominio-bh".tb_consumo_registros cr
          LEFT JOIN "condominio-bh".tb_consumo_tipo ct
            ON ct.id = cr.id_tipo_consumo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = cr.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = cr.id_condominio
          WHERE ${whereClause}
          ORDER BY cr.created_at DESC, cr.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: rows
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao gerar relatório de consumo no PostgreSQL',
        detail: error.message
      });
    }
  }

  async relatorioReservas(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar relatório de reservas.'
        });
      }

      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      const periodoInicio =
        this._normalizarTextoOuNull(req.query.periodo_inicio) ||
        this._normalizarTextoOuNull(req.query.periodoInicio);
      const periodoFim =
        this._normalizarTextoOuNull(req.query.periodo_fim) ||
        this._normalizarTextoOuNull(req.query.periodoFim);
      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      const idEspacoFiltro = this._toInt(req.query.id_espaco, null);
      const idUsuarioFiltro = this._toInt(req.query.id_usuario, null);

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 500);
      const offset = (page - 1) * pageSize;

      const replacements = {
        eh_admin: ehAdmin,
        id_condominio_token: idCondominioToken,
        limit: pageSize,
        offset
      };

      const whereParts = [
        `(
          :eh_admin = true
          OR ea.id_condominio = :id_condominio_token
        )`
      ];

      if (idCondominioFiltro) {
        if (!ehAdmin && idCondominioFiltro !== idCondominioToken) {
          return res.status(403).json({
            message: 'Sem permissão para consultar relatório de reservas de outro condomínio.'
          });
        }

        whereParts.push('ea.id_condominio = :id_condominio_filtro');
        replacements.id_condominio_filtro = idCondominioFiltro;
      }

      if (idEspacoFiltro) {
        whereParts.push('ea.id_espaco = :id_espaco');
        replacements.id_espaco = idEspacoFiltro;
      }

      if (idUsuarioFiltro) {
        whereParts.push('ea.id_usuario = :id_usuario');
        replacements.id_usuario = idUsuarioFiltro;
      }

      if (periodoInicio) {
        whereParts.push('ea.data_agendamento >= :periodo_inicio::date');
        replacements.periodo_inicio = periodoInicio;
      }

      if (periodoFim) {
        whereParts.push("ea.data_agendamento < (:periodo_fim::date + INTERVAL '1 day')");
        replacements.periodo_fim = periodoFim;
      }

      if (statusFiltro) {
        const statusTokens = String(statusFiltro)
          .split(',')
          .map((item) => String(item).trim().toLowerCase())
          .filter((item) => item !== '');

        const hasTodos = statusTokens.some((item) => ['todos', 'all'].includes(item));
        if (!hasTodos) {
          const statusIds = [
            ...new Set(
              statusTokens
                .map((item) => this._toInt(item, null))
                .filter((item) => item !== null && item > 0)
            )
          ];

          if (statusIds.length === 1) {
            whereParts.push('ea.status = :status_id');
            replacements.status_id = statusIds[0];
          } else if (statusIds.length > 1) {
            whereParts.push('ea.status IN (:status_ids)');
            replacements.status_ids = statusIds;
          }
        }
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_espaco_agenda ea
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = ea.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = ea.id_condominio
          LEFT JOIN "condominio-bh".tb_espaco e
            ON e.id = ea.id_espaco
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const rows = await postgres.query(
        `SELECT
            ea.id,
            ea.id_condominio,
            ea.id_espaco,
            ea.id_usuario,
            ea.id_usuario_cadastro,
            ea.observacoes,
            ea.created_at AS data_cadastro,
            ea.data_agendamento,
            ea.periodo_manha,
            ea.periodo_tarde,
            ea.periodo_noite,
            ea.status,
            tu.nome || ' ' || tu.sobrenome AS nome_morador,
            tu.apartamento,
            tu.bloco as torre,
            tc.nome AS nome_condominio,
            tc.cnpj AS cnpj_condominio,
            tc.email AS email_condominio,
            e.nome AS nome_espaco,
            ea.taxa_reserva,
            est.descricao_status AS descricao_status,
            tu_cadastro.nome || ' ' || tu_cadastro.sobrenome AS nome_usuario_cadastro
          FROM "condominio-bh".tb_espaco_agenda ea
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = ea.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = ea.id_condominio
          LEFT JOIN "condominio-bh".tb_espaco e
            ON e.id = ea.id_espaco
          LEFT JOIN "condominio-bh".tb_status_tratamento est
            ON est.id = ea.status
          LEFT JOIN "condominio-bh"."tb-usuarios" tu_cadastro
            ON tu_cadastro.id = ea.id_usuario_cadastro
          WHERE ${whereClause}
          ORDER BY ea.data_agendamento asc, ea.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: rows
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao gerar relatório de reservas no PostgreSQL',
        detail: error.message
      });
    }
  }

  async relatorioComunicacoes(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para consultar relatório de comunicações.'
        });
      }

      const statusFiltro = this._normalizarTextoOuNull(req.query.status);
      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      const idTipoDashboardFiltro = this._toInt(req.query.tipo ?? req.query.id_tipo_dashboard, null);
      const idUsuarioLancamentoFiltro = this._toInt(
        req.query.id_usuario_lancamento ?? req.query.id_usuario,
        null
      );
      const periodoInicio =
        this._normalizarTextoOuNull(req.query.periodo_inicio) ||
        this._normalizarTextoOuNull(req.query.periodoInicio);
      const periodoFim =
        this._normalizarTextoOuNull(req.query.periodo_fim) ||
        this._normalizarTextoOuNull(req.query.periodoFim);

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 500);
      const offset = (page - 1) * pageSize;

      const replacements = {
        eh_admin: ehAdmin,
        id_condominio_token: idCondominioToken,
        limit: pageSize,
        offset
      };

      const whereParts = [
        `(
          :eh_admin = true
          OR dr.id_condominio = :id_condominio_token
        )`
      ];

      if (idCondominioFiltro) {
        if (!ehAdmin && idCondominioFiltro !== idCondominioToken) {
          return res.status(403).json({
            message: 'Sem permissão para consultar comunicações de outro condomínio.'
          });
        }

        whereParts.push('dr.id_condominio = :id_condominio_filtro');
        replacements.id_condominio_filtro = idCondominioFiltro;
      }

      if (idTipoDashboardFiltro) {
        whereParts.push('dr.tipo = :tipo');
        replacements.tipo = idTipoDashboardFiltro;
      }

      if (idUsuarioLancamentoFiltro) {
        whereParts.push('dr.id_usuario = :id_usuario_lancamento');
        replacements.id_usuario_lancamento = idUsuarioLancamentoFiltro;
      }

      if (periodoInicio) {
        whereParts.push('dr.created_at >= :periodo_inicio::date');
        replacements.periodo_inicio = periodoInicio;
      }

      if (periodoFim) {
        whereParts.push("dr.created_at < (:periodo_fim::date + INTERVAL '1 day')");
        replacements.periodo_fim = periodoFim;
      }

      if (statusFiltro) {
        const statusTokens = String(statusFiltro)
          .split(',')
          .map((item) => String(item).trim().toLowerCase())
          .filter((item) => item !== '');

        const hasTodos = statusTokens.some((item) => ['todos', 'all'].includes(item));
        if (!hasTodos && statusTokens.length > 0) {
          whereParts.push("LOWER(COALESCE(dr.status, '')) IN (:status_list)");
          replacements.status_list = [...new Set(statusTokens)];
        }
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_dashboard_registro dr
          LEFT JOIN "condominio-bh".tb_dashboard_tipo dt
            ON dt.id = dr.tipo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = dr.id_usuario
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const rows = await postgres.query(
        `SELECT
            dr.id,
            dr.tipo,
            dt.codigo AS tipo_codigo,
            dt.descricao AS tipo_descricao,
            dr.titulo,
            dr.descricao,
            dr.status,
            dr.data_inicio,
            dr.data_fim,
            dr.data_referencia,
            dr.origem,
            dr.prioridade,
            dr.exibicao_dashboard,
            dr.id_usuario AS id_usuario_lancamento,
            tu.nome || ' ' || tu.sobrenome AS nome_usuario_lancamento,
            tu.sobrenome AS sobrenome_usuario_lancamento,
            TRIM(COALESCE(tu.nome, '') || ' ' || COALESCE(tu.sobrenome, '')) AS usuario_lancamento_nome_completo,
            tu.email AS usuario_lancamento_email,
            dr.id_condominio,
            c.nome AS nome_condominio,
            c.cnpj AS cnpj_condominio,
            c.email AS email_condominio,
            dr.created_at,
            dr.updated_at
          FROM "condominio-bh".tb_dashboard_registro dr
          LEFT JOIN "condominio-bh".tb_dashboard_tipo dt
            ON dt.id = dr.tipo
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
            ON tu.id = dr.id_usuario
          LEFT JOIN "condominio-bh"."tb-condominios" c
            ON c.id = dr.id_condominio
          WHERE ${whereClause}
          ORDER BY dr.id DESC, dr.created_at DESC 
          LIMIT :limit OFFSET :offset`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: rows
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao gerar relatório de comunicações no PostgreSQL',
        detail: error.message
      });
    }
  }

  async relatorioExportPdf(req, res) {
    try {
      const modulo = this._normalizarTextoOuNull(req.query.modulo);
      const moduloNormalizado = String(modulo || '').trim().toLowerCase();

      if (moduloNormalizado === 'usuarios') {
        return this.relatorioUsuarios(req, res);
      }

      if (moduloNormalizado === 'consumo') {
        return this.relatorioConsumo(req, res);
      }

      if (moduloNormalizado === 'reserva' || moduloNormalizado === 'reservas') {
        return this.relatorioReservas(req, res);
      }

      if (moduloNormalizado === 'comunicacao' || moduloNormalizado === 'comunicacoes') {
        return this.relatorioComunicacoes(req, res);
      }

      return res.status(400).json({
        message: 'Módulo de relatório inválido.',
        modulos_suportados: ['usuarios', 'consumo', 'reserva', 'comunicacoes']
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao processar relatorio-export-pdf.php',
        detail: error.message
      });
    }
  }

  async listarUsuariosPorPerfis(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar usuários por perfil.'
        });
      }

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (idCondominioFiltro && !ehAdmin && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para listar usuários de outro condomínio.'
        });
      }

      const idCondominioRef = idCondominioFiltro || idCondominioToken;
      if (!idCondominioRef) {
        return res.status(400).json({
          message: 'Informe id_condominio na query string (obrigatório para Admin).'
        });
      }

      const perfilIdsRaw =
        req.query.perfil_ids ?? req.query.tipo_perfil_ids ?? req.query.id_perfil ?? req.query.id_perfis;

      const perfilIds = String(perfilIdsRaw || '')
        .split(',')
        .map((item) => this._toInt(item.trim(), null))
        .filter((item) => item !== null && item > 0);

      const perfilIdsUnicos = [...new Set(perfilIds)];
      const perfilIdsTexto = perfilIdsUnicos.map((item) => String(item));

      if (perfilIdsUnicos.length === 0) {
        return res.status(400).json({
          message: 'Informe ao menos um perfil válido em perfil_ids (ex.: 1,2,3).'
        });
      }

      const data = await postgres.query(
        `SELECT
            tu.id,
            tu.id_condominio,
            tc.nome AS nome_condominio,
            tc.escrita_bloco,
            tc.qtde_ap_bloco,
            tc.modelo_fatura,
            tc.qtde_blocos,
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.telefone,
            tu.path_avatar,
            tu.tipo_morador,
            tu.tipo_perfil_id,
            tu.tipo,
            tu.status,
            tu.apartamento,
            tu.bloco,
            tu.created_at,
            tu.updated_at
          FROM "condominio-bh"."tb-usuarios" tu
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = tu.id_condominio
          WHERE tu.id_condominio = :id_condominio
            AND tu.tipo_perfil_id::text IN (:perfil_ids)
          ORDER BY tu.nome ASC, tu.id ASC`,
        {
          replacements: {
            id_condominio: idCondominioRef,
            perfil_ids: perfilIdsTexto
          },
          type: QueryTypes.SELECT
        }
      );

      const usuarioLogadoRows = idUsuarioToken
        ? await postgres.query(
            `SELECT
                tu.id,
                tu.id_condominio,
                tc.nome AS nome_condominio,
                tc.escrita_bloco,
                tc.qtde_ap_bloco,
                tc.modelo_fatura,
                tc.qtde_blocos,
                tu.nome,
                tu.sobrenome,
                tu.apartamento,
                tu.bloco,
                tu.email,
                tu.tipo_perfil_id,
                tu.tipo
              FROM "condominio-bh"."tb-usuarios" tu
              LEFT JOIN "condominio-bh"."tb-condominios" tc
                ON tc.id = tu.id_condominio
              WHERE tu.id = :id_usuario
                AND tu.id_condominio = :id_condominio
              ORDER BY tu.nome ASC, tu.id ASC  
              LIMIT 1`,
            {
              replacements: {
                id_usuario: idUsuarioToken,
                id_condominio: idCondominioToken
              },
              type: QueryTypes.SELECT
            }
          )
        : [];

      const usuarioLogado = usuarioLogadoRows && usuarioLogadoRows.length > 0 ? usuarioLogadoRows[0] : null;

      return res.status(200).json({
        total: data.length,
        filtros: {
          id_condominio: idCondominioRef,
          perfil_ids: perfilIdsUnicos
        },
        usuario_logado: usuarioLogado,
        data: this._anexarAvatarUrlUsuarios(req, data)
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar usuários por perfis.',
        detail: error.message
      });
    }
  }

  async listarUsuariosPorCondominio(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const ehAdmin = idPerfilToken === 1;

      const idCondominioParam = this._toInt(req.params.id_condominio, null);
      if (!idCondominioParam) {
        return res.status(400).json({
          message: 'Parâmetro id_condominio inválido.'
        });
      }

      if (!ehAdmin && (!idCondominioToken || idCondominioToken !== idCondominioParam)) {
        return res.status(403).json({
          message: 'Usuário sem permissão para listar usuários deste condomínio.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 500), 1), 500);
      const offset = (page - 1) * pageSize;

      const replacements = {
        id_condominio: idCondominioParam,
        limit: pageSize,
        offset
      };

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh"."tb-usuarios" tu
          WHERE tu.id_condominio = :id_condominio
          `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const rows = await postgres.query(
        `SELECT DISTINCT
    tcu.id AS id_unidade,
    tcu.unidades_bloco ,
    tcu.bloco AS bloco_unidade,
    tu.id,
    tu.id_condominio,
    tc.nome AS nome_condominio,
    tc.escrita_bloco,
    tc.qtde_ap_bloco,
    tc.modelo_fatura,
    tc.qtde_blocos,
    tu.nome,
    tu.sobrenome,
    tu.cpf,
    tu.email,
    tu.telefone,
    tu.path_avatar,
    tu.tipo_morador,
    tu.tipo_perfil_id,
    tu.tipo,
    tu.status,
    tu.apartamento,
    tu.bloco,
    tu.created_at,
    tu.updated_at,
    tu.apartamento::int AS apartamento_ordem
    FROM "condominio-bh"."tb-condominios" tc
    INNER JOIN "condominio-bh".tb_condominios_unidades tcu
        ON tc.id = tcu.id_condominio
    LEFT JOIN "condominio-bh"."tb-usuarios" tu
        ON tu.id_condominio = tc.id
        AND tu.id_unidade_predio = tcu.id
    WHERE tc.id = :id_condominio
    ORDER BY
    apartamento_ordem ASC,
    tu.nome ASC,
    tu.id ASC
    LIMIT :limit OFFSET :offset  `,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        id_condominio: idCondominioParam,
        data: this._anexarAvatarUrlUsuarios(req, rows)
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar usuários por condomínio.',
        detail: error.message
      });
    }
  }

  async criarUsuario(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para criar usuário.'
        });
      }

      const {
        nome,
        sobrenome,
        cpf,
        email,
        telefone,
        data_nascimento,
        genero,
        tipo_morador,
        tipo_perfil_id,
        tipo,
        status,
        endereco_logradouro,
        endereco_numero,
        endereco_complemento,
        endereco_bairro,
        endereco_cidade,
        endereco_uf,
        endereco_cep,
        apartamento,
        bloco,
        id_unidade,
        observacoes,
        path_avatar,
        password
      } = req.body;

      const cpfNumerico = String(cpf || '').replace(/\D/g, '');
      let cpfLimpo = cpfNumerico || null;

      if (!cpfLimpo) {
        for (let tentativas = 0; tentativas < 8; tentativas += 1) {
          const base = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
          const cpfGerado = base.replace(/\D/g, '').slice(-11).padStart(11, '0');

          const existente = await postgres.query(
            `SELECT id
               FROM "condominio-bh"."tb-usuarios"
              WHERE cpf = :cpf
              LIMIT 1`,
            {
              replacements: { cpf: cpfGerado },
              type: QueryTypes.SELECT
            }
          );

          if (!existente || existente.length === 0) {
            cpfLimpo = cpfGerado;
            break;
          }
        }
      }

      if (!cpfLimpo) {
        return res.status(500).json({
          message: 'Falha ao criar usuário.',
          detail: 'Não foi possível gerar CPF técnico para cadastro sem CPF.'
        });
      }

      const emailNormalizado = email ? String(email).trim().toLowerCase() : null;

      let duplicado = [];
      if (cpfLimpo || emailNormalizado) {
        duplicado = await postgres.query(
          `SELECT id, cpf, email
             FROM "condominio-bh"."tb-usuarios"
            WHERE (:cpf IS NOT NULL AND cpf = :cpf)
               OR (:email IS NOT NULL AND lower(email) = :email)
            LIMIT 1`,
          {
            replacements: {
              cpf: cpfLimpo,
              email: emailNormalizado
            }
          }
        );
      }

      if (duplicado[0] && duplicado[0].length > 0) {
        return res.status(409).json({
          message: 'Já existe usuário cadastrado com esse CPF ou e-mail.'
        });
      }

      const senha_hash = await bcrypt.hash(String(password), 10);

      let tipoResolvido = tipo || null;
      if (!tipoResolvido && tipo_perfil_id) {
        const perfilRow = await postgres.query(
          `SELECT nome FROM "condominio-bh".tb_sgw_perfil WHERE id = :id LIMIT 1`,
          { replacements: { id: this._toInt(tipo_perfil_id, null) }, type: QueryTypes.SELECT }
        );
        tipoResolvido = perfilRow?.[0]?.nome ? this._normalizarPerfil(perfilRow[0].nome) : null;
      }
      tipoResolvido = tipoResolvido || 'morador';

      let idUnidadePredioResolvido = null;
      let apartamentoResolvido = apartamento || null;
      let blocoResolvido = bloco || null;

      const idUnidadeInformado = this._toInt(id_unidade, null);
      if (idUnidadeInformado) {
        const unidadeRow = await postgres.query(
          `SELECT id, bloco, unidades_bloco FROM "condominio-bh".tb_condominios_unidades
            WHERE id = :id AND id_condominio = :id_condominio
            LIMIT 1`,
          {
            replacements: { id: idUnidadeInformado, id_condominio: idCondominioToken },
            type: QueryTypes.SELECT
          }
        );
        if (!unidadeRow || unidadeRow.length === 0) {
          return res.status(422).json({
            message: 'id_unidade inválido para este condomínio.'
          });
        }
        idUnidadePredioResolvido = idUnidadeInformado;
        apartamentoResolvido = unidadeRow[0].unidades_bloco;
        blocoResolvido = String(unidadeRow[0].bloco);
      } else if (apartamento && bloco) {
        const unidadeRow = await postgres.query(
          `SELECT id FROM "condominio-bh".tb_condominios_unidades
            WHERE id_condominio = :id_condominio
              AND unidades_bloco = :apartamento
              AND bloco = :bloco
            LIMIT 1`,
          {
            replacements: {
              id_condominio: idCondominioToken,
              apartamento: String(apartamento).trim(),
              bloco: this._toInt(bloco, null)
            },
            type: QueryTypes.SELECT
          }
        );
        if (unidadeRow && unidadeRow.length > 0) {
          idUnidadePredioResolvido = this._toInt(unidadeRow[0].id, null);
        }
      }

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh"."tb-usuarios" (
            id_condominio,
            nome,
            sobrenome,
            cpf,
            email,
            telefone,
            data_nascimento,
            genero,
            tipo_morador,
            tipo_perfil_id,
            tipo,
            status,
            senha_hash,
            endereco_logradouro,
            endereco_numero,
            endereco_complemento,
            endereco_bairro,
            endereco_cidade,
            endereco_uf,
            endereco_cep,
            apartamento,
            bloco,
            id_unidade_predio,
            observacoes,
            path_avatar,
            created_at,
            updated_at
        ) VALUES (
            :id_condominio,
            :nome,
            :sobrenome,
            :cpf,
            :email,
            :telefone,
            :data_nascimento,
            :genero,
            :tipo_morador,
            :tipo_perfil_id,
            :tipo,
            :status,
            :senha_hash,
            :endereco_logradouro,
            :endereco_numero,
            :endereco_complemento,
            :endereco_bairro,
            :endereco_cidade,
            :endereco_uf,
            :endereco_cep,
            :apartamento,
            :bloco,
            :id_unidade_predio,
            :observacoes,
            :path_avatar,
            now(),
            now()
        )
        RETURNING id, id_condominio, nome, sobrenome, cpf, email, telefone, path_avatar, tipo_morador, tipo_perfil_id, tipo, status, apartamento, bloco, id_unidade_predio, created_at`,
        {
          replacements: {
            id_condominio: idCondominioToken,
            nome,
            sobrenome: sobrenome || null,
            cpf: cpfLimpo,
            email: emailNormalizado,
            telefone: telefone || null,
            data_nascimento: data_nascimento || null,
            genero: genero || null,
            tipo_morador: tipo_morador || null,
            tipo_perfil_id: this._toInt(tipo_perfil_id, null),
            tipo: tipoResolvido,
            status: status || 'ativo',
            senha_hash,
            endereco_logradouro: endereco_logradouro || null,
            endereco_numero: endereco_numero || null,
            endereco_complemento: endereco_complemento || null,
            endereco_bairro: endereco_bairro || null,
            endereco_cidade: endereco_cidade || null,
            endereco_uf: endereco_uf || null,
            endereco_cep: endereco_cep || null,
            apartamento: apartamentoResolvido,
            bloco: blocoResolvido,
            id_unidade_predio: idUnidadePredioResolvido,
            observacoes: observacoes || null,
            path_avatar: path_avatar || null
          }
        }
      );

      return res.status(201).json({
        message: 'Usuário criado com sucesso.',
        data: this._anexarAvatarUrlUsuario(req, insert[0][0])
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao criar usuário.',
        detail: error.message
      });
    }
  }

  async gerarConviteMorador(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({ message: 'Token sem id_condominio para gerar convite.' });
      }

      const idPerfilToken = this._toInt(req.IdPerfil, null);
      if (![1, 3, 4].includes(idPerfilToken)) {
        return res.status(403).json({ message: 'Apenas administradores e síndicos podem gerar convites.' });
      }

      const emailConvidado = this._normalizarEmailOuNull(req.body.email);
      if (!emailConvidado) {
        return res.status(400).json({ message: 'Campo email é obrigatório para gerar convite.' });
      }

      const apartamento = req.body.apartamento ? String(req.body.apartamento).trim() : null;
      const bloco = req.body.bloco ? String(req.body.bloco).trim() : null;
      const mensagem = req.body.mensagem ? String(req.body.mensagem).trim() : null;
      const baseUrl = req.body.base_url
        ? String(req.body.base_url).trim()
        : process.env.APP_URL || process.env.BASE_URL || '';

      const condominioRows = await postgres.query(
        `SELECT id, nome FROM "condominio-bh"."tb-condominios" WHERE id = :id LIMIT 1`,
        { replacements: { id: idCondominioToken }, type: QueryTypes.SELECT }
      );

      if (!condominioRows || condominioRows.length === 0) {
        return res.status(404).json({ message: 'Condomínio não encontrado.' });
      }

      const condominio = condominioRows[0];

      const inviteToken = jwt.sign(
        {
          id_condominio: idCondominioToken,
          email: emailConvidado,
          apartamento: apartamento || null,
          bloco: bloco || null,
          flow: 'morador_invite'
        },
        INVITE_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      waitUntil((async () => {
        try {
          await despacharEmailReserva({
            _ref: `convite_${idCondominioToken}_${Date.now()}`,
            template: 'morador_convite',
            emails: [emailConvidado],
            condominio_id: idCondominioToken,
            condominio_nome: condominio.nome || '',
            base_url: baseUrl,
            token: inviteToken,
            ...(mensagem ? { mensagem } : {})
          });
        } catch (emailErr) {
          console.error('[emailDispatch] Erro convite morador:', emailErr?.message);
        }
      })());

      return res.status(201).json({
        message: 'Convite gerado e e-mail de convite enviado.',
        data: {
          email: emailConvidado,
          apartamento,
          bloco,
          invite_token: inviteToken,
          expires_in: '7d'
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao gerar convite de morador.',
        detail: error.message
      });
    }
  }

  async cadastrarUsuarioPorConvite(req, res) {
    try {
      const inviteToken = this._normalizarTextoOuNull(req.body.invite_token ?? req.body.token);
      if (!inviteToken) {
        return res.status(422).json({
          message: 'Campo invite_token (ou token) é obrigatório.'
        });
      }

      const requestIp = this._resolveRequestIp(req) || 'ip-desconhecido';
      const emailRate = this._normalizarEmailOuNull(req.body.email) || 'sem-email';
      const rateLimit = this._consumePublicRegistrationAttempt(requestIp, emailRate);

      if (!rateLimit.allowed) {
        return res.status(422).json({
          message: 'Muitas tentativas de cadastro por convite. Tente novamente em instantes.',
          retry_after_seconds: rateLimit.retryAfterSeconds
        });
      }

      let invitePayload;
      try {
        invitePayload = this._verifyInviteToken(inviteToken);
      } catch (tokenError) {
        return res.status(422).json({
          message: 'invite_token inválido ou expirado.'
        });
      }

      const inviteTokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
      const inviteJti = this._normalizarTextoOuNull(invitePayload.jti);
      const inviteJtiKey = inviteJti ? `jti:${inviteJti}` : null;

      const inviteTokenNoLimite = this._isInviteTokenAlreadyUsed(inviteTokenHash);
      const inviteJtiNoLimite = inviteJtiKey ? this._isInviteTokenAlreadyUsed(inviteJtiKey) : false;
      if (inviteTokenNoLimite || inviteJtiNoLimite) {
        const usosAtuais = Math.max(
          this._getInviteTokenUsageCount(inviteTokenHash),
          inviteJtiKey ? this._getInviteTokenUsageCount(inviteJtiKey) : 0
        );

        return res.status(422).json({
          message: `invite_token atingiu o limite de ${INVITE_TOKEN_MAX_USES} usos.`,
          invite_token_max_uses: INVITE_TOKEN_MAX_USES,
          invite_token_used_count: usosAtuais
        });
      }

      const idCondominioToken = this._toInt(
        invitePayload.id_condominio ?? invitePayload.condominio_id ?? invitePayload.idCondominio,
        null
      );
      const apartamentoToken = this._normalizarTextoOuNull(
        invitePayload.apartamento ?? invitePayload.encomenda_apartamento
      );
      const blocoToken = this._normalizarTextoOuNull(invitePayload.bloco ?? invitePayload.encomenda_bloco);
      const unidadesBlocoToken = Array.isArray(invitePayload.unidades_bloco)
        ? invitePayload.unidades_bloco
            .map((item) => this._normalizarTextoOuNull(item))
            .filter((item) => item !== null)
        : [];
      const qtdeBlocosToken = this._toInt(invitePayload.qtde_blocos, null);
      const emailToken = this._normalizarEmailOuNull(invitePayload.email ?? invitePayload.email_usuario);

      if (!idCondominioToken) {
        return res.status(422).json({
          message: 'invite_token inválido para cadastro: dados de condomínio ausentes.'
        });
      }

      const idCondominioBody = this._toInt(req.body.id_condominio ?? req.body.condominio_id, null);
      const apartamentoBody = this._normalizarTextoOuNull(req.body.apartamento);
      const blocoBody = this._normalizarTextoOuNull(req.body.bloco);
      const emailBody = this._normalizarEmailOuNull(req.body.email);

      if (idCondominioBody && idCondominioBody !== idCondominioToken) {
        return res.status(422).json({
          message: 'Dados inválidos para cadastro por convite.'
        });
      }

      if (apartamentoToken && apartamentoBody && apartamentoBody !== apartamentoToken) {
        return res.status(422).json({ message: 'Dados inválidos para cadastro por convite.' });
      }

      if (!apartamentoToken && apartamentoBody && unidadesBlocoToken.length > 0) {
        if (!unidadesBlocoToken.includes(apartamentoBody)) {
          return res.status(422).json({ message: 'Dados inválidos para cadastro por convite.' });
        }
      }

      if (blocoToken && blocoBody && blocoBody !== blocoToken) {
        return res.status(422).json({ message: 'Dados inválidos para cadastro por convite.' });
      }

      if (!blocoToken && blocoBody && qtdeBlocosToken && qtdeBlocosToken > 1) {
        // Quando há mais de 1 bloco, valida que o valor enviado é um número inteiro no intervalo válido.
        // Quando qtde_blocos === 1, qualquer valor de bloco é aceito (label como "Torre 1" é válido).
        const blocoBodyInt = this._toInt(blocoBody, null);
        if (!blocoBodyInt || blocoBodyInt < 1 || blocoBodyInt > qtdeBlocosToken) {
          return res.status(422).json({ message: 'Dados inválidos para cadastro por convite.' });
        }
      }

      if (emailToken && emailBody && emailBody !== emailToken) {
        return res.status(422).json({
          message: 'Dados inválidos para cadastro por convite.'
        });
      }

      const apartamentoCadastro = apartamentoBody || apartamentoToken || null;
      // Quando qtde_blocos === 1 normaliza sempre para '1', independente do label enviado ("Torre 1", "Torre", etc.)
      const blocoCadastro =
        blocoToken ||
        (qtdeBlocosToken === 1 ? '1' : null) ||
        (this._toInt(blocoBody, null) !== null ? String(this._toInt(blocoBody, null)) : null);

      if (!apartamentoCadastro || !blocoCadastro) {
        return res.status(422).json({
          message: 'Dados inválidos para cadastro por convite.'
        });
      }

      const emailCadastro = emailBody || emailToken;
      const cpfNumerico = String(req.body.cpf || '').replace(/\D/g, '');
      let cpfLimpo = cpfNumerico || null;

      if (!cpfLimpo) {
        for (let tentativas = 0; tentativas < 8; tentativas += 1) {
          const base = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
          const cpfGerado = base.replace(/\D/g, '').slice(-11).padStart(11, '0');

          const existenteCpf = await postgres.query(
            `SELECT id
               FROM "condominio-bh"."tb-usuarios"
              WHERE cpf = :cpf
              LIMIT 1`,
            {
              replacements: { cpf: cpfGerado },
              type: QueryTypes.SELECT
            }
          );

          if (!existenteCpf || existenteCpf.length === 0) {
            cpfLimpo = cpfGerado;
            break;
          }
        }
      }

      if (!cpfLimpo) {
        return res.status(422).json({
          message: 'Dados inválidos para cadastro por convite.'
        });
      }

      let duplicado = [];
      if (cpfLimpo || emailCadastro) {
        duplicado = await postgres.query(
          `SELECT id, cpf, email
             FROM "condominio-bh"."tb-usuarios"
            WHERE (:cpf IS NOT NULL AND cpf = :cpf)
               OR (:email IS NOT NULL AND lower(email) = :email)
            LIMIT 1`,
          {
            replacements: {
              cpf: cpfLimpo,
              email: emailCadastro
            },
            type: QueryTypes.SELECT
          }
        );
      }

      if (duplicado && duplicado.length > 0) {
        return res.status(422).json({
          message: 'Cadastro não concluído: um dos dados informados já está associado a uma conta existente.'
        });
      }

      const senha_hash = await bcrypt.hash(String(req.body.password), 10);

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh"."tb-usuarios" (
            id_condominio,
            nome,
            sobrenome,
            cpf,
            email,
            telefone,
            data_nascimento,
            genero,
            tipo_morador,
            tipo_perfil_id,
            tipo,
            status,
            senha_hash,
            endereco_logradouro,
            endereco_numero,
            endereco_complemento,
            endereco_bairro,
            endereco_cidade,
            endereco_uf,
            endereco_cep,
            apartamento,
            bloco,
            observacoes,
            path_avatar,
            created_at,
            updated_at
        ) VALUES (
            :id_condominio,
            :nome,
            :sobrenome,
            :cpf,
            :email,
            :telefone,
            :data_nascimento,
            :genero,
            :tipo_morador,
            :tipo_perfil_id,
            :tipo,
            :status,
            :senha_hash,
            :endereco_logradouro,
            :endereco_numero,
            :endereco_complemento,
            :endereco_bairro,
            :endereco_cidade,
            :endereco_uf,
            :endereco_cep,
            :apartamento,
            :bloco,
            :observacoes,
            :path_avatar,
            now(),
            now()
        )
        RETURNING id, id_condominio, nome, sobrenome, cpf, email, telefone, path_avatar, tipo_morador, tipo_perfil_id, tipo, status, apartamento, bloco, created_at`,
        {
          replacements: {
            id_condominio: idCondominioToken,
            nome: this._normalizarNomeCapitalizado(req.body.nome),
            sobrenome: this._normalizarNomeCapitalizado(req.body.sobrenome),
            cpf: cpfLimpo,
            email: emailCadastro,
            telefone: this._normalizarTextoOuNull(req.body.telefone),
            data_nascimento: req.body.data_nascimento || null,
            genero: this._normalizarTextoOuNull(req.body.genero),
            tipo_morador: this._normalizarTextoOuNull(req.body.tipo_morador),
            tipo_perfil_id: 2,
            tipo: 'morador',
            status: this._normalizarTextoOuNull(req.body.status) || 'ativo',
            senha_hash,
            endereco_logradouro: this._normalizarTextoOuNull(req.body.endereco_logradouro),
            endereco_numero: this._normalizarTextoOuNull(req.body.endereco_numero),
            endereco_complemento: this._normalizarTextoOuNull(req.body.endereco_complemento),
            endereco_bairro: this._normalizarTextoOuNull(req.body.endereco_bairro),
            endereco_cidade: this._normalizarTextoOuNull(req.body.endereco_cidade),
            endereco_uf: this._normalizarTextoOuNull(req.body.endereco_uf),
            endereco_cep: this._normalizarTextoOuNull(req.body.endereco_cep),
            apartamento: apartamentoCadastro,
            bloco: blocoCadastro,
            observacoes: this._normalizarTextoOuNull(req.body.observacoes),
            path_avatar: this._normalizarTextoOuNull(req.body.path_avatar)
          }
        }
      );

      this._markInviteTokenAsUsed(inviteTokenHash);
      if (inviteJtiKey) {
        this._markInviteTokenAsUsed(inviteJtiKey);
      }

      return res.status(201).json({
        message: 'Usuário criado com sucesso por convite.',
        data: this._anexarAvatarUrlUsuario(req, insert[0][0])
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao criar usuário por convite.',
        detail: error.message
      });
    }
  }

  async authRecoveryLookup(req, res) {
    try {
      const loginRaw = this._normalizarTextoOuNull(req.body?.login);
      if (!loginRaw) {
        return res.status(400).json({
          success: false,
          message: 'Campo login é obrigatório.'
        });
      }

      const loginEmail = String(loginRaw).trim().toLowerCase();
      const loginCpf = String(loginRaw).replace(/\D/g, '');

      const usuarios = await postgres.query(
        `SELECT
            tu.id,
            tu.id_condominio,
            tu.nome,
            tu.sobrenome,
            tu.email,
            tu.cpf,
            tu.status,
            tc.nome AS nome_condominio,
            tc.ativo AS condominio_ativo
           FROM "condominio-bh"."tb-usuarios" tu
           LEFT JOIN "condominio-bh"."tb-condominios" tc
             ON tc.id::text = tu.id_condominio::text
          WHERE (lower(tu.email) = :login_email OR tu.cpf = :login_cpf)
          ORDER BY tu.id DESC
          LIMIT 1`,
        {
          replacements: {
            login_email: loginEmail,
            login_cpf: loginCpf
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuarios || usuarios.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Usuario nao encontrado para o e-mail/CPF informado.'
        });
      }

      const usuario = usuarios[0];
      const usuarioAtivo = ['ativo'].includes(String(usuario.status || '').trim().toLowerCase());
      const condominioAtivo = Boolean(usuario.condominio_ativo);

      if (!usuarioAtivo || !condominioAtivo) {
        return res.status(200).json({
          success: false,
          message: 'Dados com impedimentos, favor procurar o sindico.'
        });
      }

      const inviteToken = jwt.sign(
        {
          id_usuario: this._toInt(usuario.id, null),
          id_condominio: this._toInt(usuario.id_condominio, null),
          email: this._normalizarEmailOuNull(usuario.email),
          flow: 'password_recovery',
          jti: crypto.randomBytes(16).toString('hex')
        },
        INVITE_TOKEN_SECRET,
        { expiresIn: '24h' }
      );

      // Código de 6 dígitos para exibição no e-mail — válido por 10 minutos
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const emailUsuario = this._normalizarEmailOuNull(usuario.email);
      const idUsuarioLookup = this._toInt(usuario.id, null);
      const idCondominioLookup = this._toInt(usuario.id_condominio, null);
      const codeHashLookup = await bcrypt.hash(otpCode, 10);
      const expiresAtLookup = new Date(Date.now() + RECOVERY_OTP_TTL_MS);

      // Persistido em tb_recovery_tokens (não em memória) — precisa sobreviver
      // entre esta requisição e a de verificação, que pode cair numa instância
      // serverless diferente na Vercel.
      await postgres.query(
        `DELETE FROM "condominio-bh".tb_recovery_tokens WHERE id_usuario = :id_usuario AND consumed_at IS NULL`,
        { replacements: { id_usuario: idUsuarioLookup }, type: QueryTypes.DELETE }
      );

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_recovery_tokens
           (id_usuario, id_condominio, code_hash, invite_token, expires_at, attempts, created_at, updated_at)
         VALUES (:id_usuario, :id_condominio, :code_hash, :invite_token, :expires_at, 0, NOW(), NOW())`,
        {
          replacements: {
            id_usuario: idUsuarioLookup,
            id_condominio: idCondominioLookup,
            code_hash: codeHashLookup,
            invite_token: inviteToken,
            expires_at: expiresAtLookup
          },
          type: QueryTypes.INSERT
        }
      );

      const nomeCompleto = this._normalizarNomeCapitalizado(`${usuario.nome || ''} ${usuario.sobrenome || ''}`.trim()) || null;
      const nomeCondominio = this._normalizarTextoOuNull(usuario.nome_condominio);

      return res.status(200).json({
        success: true,
        message: 'Dados validos.',
        data: {
          id_usuario: this._toInt(usuario.id, null),
          id_condominio: this._toInt(usuario.id_condominio, null),
          nome: nomeCompleto,
          email: emailUsuario,
          nome_condominio: nomeCondominio
        },
        invite_token: inviteToken,
        token: inviteToken,
        token_type: 'invite_token',
        expires_in: '24h'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Falha ao validar dados para recuperacao de senha.',
        detail: error.message
      });
    }
  }

  async authRecoveryVerifyOtp(req, res) {
    try {
      const email = this._normalizarEmailOuNull(req.body?.email);
      const code = req.body?.code !== undefined ? String(req.body.code).trim() : null;

      if (!email || !code) {
        return res.status(400).json({ success: false, message: 'Campos email e code são obrigatórios.' });
      }

      const MAX_ATTEMPTS_VERIFY = 5;

      const [entry] = await postgres.query(
        `SELECT rt.id, rt.code_hash, rt.invite_token, rt.expires_at, rt.attempts
           FROM "condominio-bh".tb_recovery_tokens rt
           JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = rt.id_usuario
          WHERE lower(tu.email) = :email
            AND rt.consumed_at IS NULL
          ORDER BY rt.created_at DESC LIMIT 1`,
        { replacements: { email }, type: QueryTypes.SELECT }
      );

      if (!entry) {
        return res.status(422).json({ success: false, message: 'Código inválido ou expirado.' });
      }

      if (new Date(entry.expires_at) < new Date()) {
        return res.status(422).json({ success: false, message: 'Código expirado. Solicite um novo.' });
      }

      if (entry.attempts >= MAX_ATTEMPTS_VERIFY) {
        return res.status(429).json({ success: false, message: 'Limite de tentativas atingido. Solicite um novo código.' });
      }

      // Incrementa tentativas antes de validar (evita timing attack)
      await postgres.query(
        `UPDATE "condominio-bh".tb_recovery_tokens SET attempts = attempts + 1, updated_at = NOW() WHERE id = :id`,
        { replacements: { id: entry.id }, type: QueryTypes.UPDATE }
      );

      const codeValido = await bcrypt.compare(code, entry.code_hash);
      if (!codeValido) {
        return res.status(422).json({ success: false, message: 'Código incorreto.' });
      }

      await postgres.query(
        `UPDATE "condominio-bh".tb_recovery_tokens SET consumed_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { replacements: { id: entry.id }, type: QueryTypes.UPDATE }
      );

      return res.status(200).json({
        success: true,
        message: 'Código validado.',
        invite_token: entry.invite_token,
        token: entry.invite_token,
        token_type: 'invite_token',
        expires_in: '24h'
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Falha ao verificar código.', detail: error.message });
    }
  }

  // ---------------------------------------------------------------------------
  // Recuperação de senha — fluxo completo para o APP React
  // ---------------------------------------------------------------------------

  async recoveryRequest(req, res) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    try {
      const loginRaw = String(req.body.login || '').trim();
      const loginEmail = loginRaw.toLowerCase();
      const loginCpf = loginRaw.replace(/\D/g, '');

      // Rate limit: 5 requisições por IP a cada 15 min
      const rateLimitKey = `recovery_req:${ip}`;
      const RATE_WINDOW = 15 * 60 * 1000;
      const RATE_MAX = 5;
      const rateEntry = recoveryOtpStore.get(rateLimitKey);
      const now = Date.now();
      if (rateEntry && rateEntry._rateLimit) {
        if (now - rateEntry.windowStart < RATE_WINDOW && rateEntry.count >= RATE_MAX) {
          return res.status(429).json({ success: false, code: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde 15 minutos.' });
        }
        if (now - rateEntry.windowStart >= RATE_WINDOW) {
          recoveryOtpStore.delete(rateLimitKey);
        }
      }
      const newRate = rateEntry && rateEntry._rateLimit && now - rateEntry.windowStart < RATE_WINDOW
        ? { _rateLimit: true, count: rateEntry.count + 1, windowStart: rateEntry.windowStart }
        : { _rateLimit: true, count: 1, windowStart: now };
      recoveryOtpStore.set(rateLimitKey, newRate);

      const [usuario] = await postgres.query(
        `SELECT tu.id, tu.id_condominio, tu.nome, tu.sobrenome, tu.email, tu.status,
                tc.nome AS nome_condominio, tc.ativo AS condominio_ativo
           FROM "condominio-bh"."tb-usuarios" tu
           LEFT JOIN "condominio-bh"."tb-condominios" tc ON tc.id::text = tu.id_condominio::text
          WHERE (lower(tu.email) = :email OR tu.cpf = :cpf)
          ORDER BY tu.id DESC LIMIT 1`,
        { replacements: { email: loginEmail, cpf: loginCpf }, type: QueryTypes.SELECT }
      );

      // Resposta genérica para não vazar se o usuário existe
      if (!usuario || !['ativo'].includes(String(usuario.status || '').toLowerCase()) || !usuario.condominio_ativo) {
        return res.status(200).json({ success: true, message: 'Se o e-mail estiver cadastrado, você receberá o código.' });
      }

      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await bcrypt.hash(otpCode, 10);
      const expiresAt = new Date(Date.now() + RECOVERY_OTP_TTL_MS);
      const idUsuario = this._toInt(usuario.id, null);
      const idCondominio = this._toInt(usuario.id_condominio, null);

      const inviteToken = jwt.sign(
        { id_usuario: idUsuario, id_condominio: idCondominio, email: this._normalizarEmailOuNull(usuario.email), flow: 'password_recovery', jti: crypto.randomBytes(16).toString('hex') },
        INVITE_TOKEN_SECRET,
        { expiresIn: '24h' }
      );

      // Remove tokens anteriores pendentes e insere o novo
      await postgres.query(
        `DELETE FROM "condominio-bh".tb_recovery_tokens WHERE id_usuario = :id_usuario AND consumed_at IS NULL`,
        { replacements: { id_usuario: idUsuario }, type: QueryTypes.DELETE }
      );

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_recovery_tokens
           (id_usuario, id_condominio, code_hash, invite_token, expires_at, attempts, created_at, updated_at)
         VALUES (:id_usuario, :id_condominio, :code_hash, :invite_token, :expires_at, 0, NOW(), NOW())`,
        { replacements: { id_usuario: idUsuario, id_condominio: idCondominio, code_hash: codeHash, invite_token: inviteToken, expires_at: expiresAt }, type: QueryTypes.INSERT }
      );

      const emailUsuario = this._normalizarEmailOuNull(usuario.email);
      const nomeCompleto = this._normalizarNomeCapitalizado(`${usuario.nome || ''} ${usuario.sobrenome || ''}`.trim()) || null;

      waitUntil((async () => {
        try {
          await despacharEmail({
            _ref: `recovery_${idUsuario}`,
            template: 'auth_recovery_token',
            email: emailUsuario || '',
            nome: nomeCompleto || '',
            token: otpCode
          });
        } catch (emailErr) {
          console.error('[recovery] Erro ao enviar e-mail:', emailErr?.message);
        }
      })());

      return res.status(200).json({
        success: true,
        message: 'Se o e-mail estiver cadastrado, você receberá o código.',
        user_id: idUsuario,
        expires_at: expiresAt.toISOString()
      });
    } catch (error) {
      console.error('[recovery/request] Erro:', error?.message);
      return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Erro interno ao processar recuperação.' });
    }
  }

  async recoveryVerify(req, res) {
    try {
      const idUsuario = this._toInt(req.body.user_id, null);
      const code = String(req.body.code || '').trim();
      const MAX_ATTEMPTS = 5;

      const [record] = await postgres.query(
        `SELECT id, code_hash, invite_token, expires_at, attempts, consumed_at
           FROM "condominio-bh".tb_recovery_tokens
          WHERE id_usuario = :id_usuario
            AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
        { replacements: { id_usuario: idUsuario }, type: QueryTypes.SELECT }
      );

      if (!record) {
        return res.status(401).json({ success: false, code: 'INVALID_CODE', message: 'Código inválido ou expirado.' });
      }

      if (new Date(record.expires_at) < new Date()) {
        return res.status(401).json({ success: false, code: 'CODE_EXPIRED', message: 'Código expirado. Solicite um novo.' });
      }

      if (record.attempts >= MAX_ATTEMPTS) {
        return res.status(429).json({ success: false, code: 'MAX_ATTEMPTS', message: 'Limite de tentativas atingido. Solicite um novo código.' });
      }

      // Incrementa tentativas antes de validar (evita timing attack)
      await postgres.query(
        `UPDATE "condominio-bh".tb_recovery_tokens SET attempts = attempts + 1, updated_at = NOW() WHERE id = :id`,
        { replacements: { id: record.id }, type: QueryTypes.UPDATE }
      );

      const codeValido = await bcrypt.compare(code, record.code_hash);
      if (!codeValido) {
        return res.status(401).json({ success: false, code: 'INVALID_CODE', message: 'Código incorreto.' });
      }

      // Marca como consumido
      await postgres.query(
        `UPDATE "condominio-bh".tb_recovery_tokens SET consumed_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { replacements: { id: record.id }, type: QueryTypes.UPDATE }
      );

      return res.status(200).json({
        success: true,
        message: 'Código validado.',
        invite_token: record.invite_token,
        token: record.invite_token,
        token_type: 'invite_token',
        expires_in: '24h'
      });
    } catch (error) {
      console.error('[recovery/verify] Erro:', error?.message);
      return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Erro interno ao verificar código.' });
    }
  }

  async recoveryReset(req, res) {
    try {
      const idUsuario = this._toInt(req.body.user_id, null);
      const inviteTokenInput = String(req.body.invite_token || '').trim();
      const novaSenha = String(req.body.password || '').trim();

      let payload;
      try {
        payload = jwt.verify(inviteTokenInput, INVITE_TOKEN_SECRET);
      } catch {
        return res.status(401).json({ success: false, code: 'INVALID_TOKEN', message: 'Token inválido ou expirado.' });
      }

      if (payload.flow !== 'password_recovery') {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Token não autorizado para esta operação.' });
      }

      if (this._toInt(payload.id_usuario, null) !== idUsuario) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Token não pertence a este usuário.' });
      }

      const senhaHash = await bcrypt.hash(novaSenha, 10);

      const updated = await postgres.query(
        `UPDATE "condominio-bh"."tb-usuarios"
            SET senha_hash = :senha_hash, updated_at = NOW()
          WHERE id = :id
          RETURNING id`,
        { replacements: { id: idUsuario, senha_hash: senhaHash }, type: QueryTypes.UPDATE }
      );

      if (!updated?.[0]?.length) {
        return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
      }

      // Invalida todos os tokens de recovery pendentes deste usuário
      await postgres.query(
        `DELETE FROM "condominio-bh".tb_recovery_tokens WHERE id_usuario = :id_usuario`,
        { replacements: { id_usuario: idUsuario }, type: QueryTypes.DELETE }
      );

      console.log(`[recovery/reset] Senha redefinida para id_usuario=${idUsuario}`);

      return res.status(200).json({ success: true, message: 'Senha redefinida com sucesso.' });
    } catch (error) {
      console.error('[recovery/reset] Erro:', error?.message);
      return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'Erro interno ao redefinir senha.' });
    }
  }

  async editarUsuario(req, res) {
    try {
      let idCondominioToken = this._toInt(req.id_condominio, null);
      let invitePayload = null;

      if (!idCondominioToken) {
        const inviteToken = this._normalizarTextoOuNull(req.body?.invite_token ?? req.body?.token);
        if (!inviteToken) {
          return res.status(403).json({
            message: 'Token sem id_condominio para editar usuário.'
          });
        }

        try {
          invitePayload = this._verifyInviteToken(inviteToken);
        } catch (tokenError) {
          return res.status(401).json({
            message: 'invite_token inválido ou expirado.'
          });
        }

        idCondominioToken = this._toInt(
          invitePayload.id_condominio ?? invitePayload.condominio_id ?? invitePayload.idCondominio,
          null
        );
      }

      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para editar usuário.'
        });
      }

      const idUsuario = this._toInt(req.params.id, null);
      if (!idUsuario) {
        return res.status(400).json({ message: 'Id do usuário inválido.' });
      }

      const usuarioAtual = await postgres.query(
        `SELECT *
           FROM "condominio-bh"."tb-usuarios"
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idUsuario,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuarioAtual || usuarioAtual.length === 0) {
        return res.status(404).json({
          message: 'Usuário não encontrado para este condomínio.'
        });
      }

      const atual = usuarioAtual[0];

      if (invitePayload) {
        const idUsuarioInvite = this._toInt(
          invitePayload.id_usuario ?? invitePayload.usuario_id ?? invitePayload.idUsuario ?? invitePayload.id,
          null
        );
        const emailInvite = this._normalizarEmailOuNull(invitePayload.email ?? invitePayload.email_usuario);
        const emailAtual = this._normalizarEmailOuNull(atual.email);

        if (idUsuarioInvite && idUsuarioInvite !== idUsuario) {
          return res.status(403).json({
            message: 'invite_token não autorizado para este usuário.'
          });
        }

        if (emailInvite && emailAtual && emailInvite !== emailAtual) {
          return res.status(403).json({
            message: 'invite_token não autorizado para este usuário.'
          });
        }
      }

      const nome = req.body.nome !== undefined ? req.body.nome : atual.nome;
      const sobrenome = req.body.sobrenome !== undefined ? req.body.sobrenome : atual.sobrenome;
      const normalizarCpf = (value) => {
        const cpfApenasDigitos = String(value || '').replace(/\D/g, '');
        return cpfApenasDigitos || null;
      };
      const cpfAtual = normalizarCpf(atual.cpf) ?? '';
      const cpfInformado = req.body.cpf !== undefined ? normalizarCpf(req.body.cpf) : undefined;
      const cpfNormalizado =
        cpfInformado === undefined || cpfInformado === null ? cpfAtual : cpfInformado;
      const emailNormalizado =
        req.body.email !== undefined
          ? req.body.email
            ? String(req.body.email).trim().toLowerCase()
            : null
          : atual.email;

      let duplicado = [];
      if (cpfNormalizado || emailNormalizado) {
        duplicado = await postgres.query(
          `SELECT id, cpf, email
             FROM "condominio-bh"."tb-usuarios"
            WHERE id <> :id_usuario
              AND (
                (:cpf IS NOT NULL AND cpf = :cpf)
                OR (:email IS NOT NULL AND lower(email) = :email)
              )
            LIMIT 1`,
          {
            replacements: {
              id_usuario: idUsuario,
              cpf: cpfNormalizado,
              email: emailNormalizado
            },
            type: QueryTypes.SELECT
          }
        );
      }

      if (duplicado && duplicado.length > 0) {
        return res.status(409).json({
          message: 'Já existe usuário cadastrado com esse CPF ou e-mail.'
        });
      }

      let senha_hash = atual.senha_hash;
      if (
        req.body.password !== undefined &&
        req.body.password !== null &&
        String(req.body.password).trim() !== ''
      ) {
        senha_hash = await bcrypt.hash(String(req.body.password), 10);
      }

      const tipoPerfilIdNovo =
        req.body.tipo_perfil_id !== undefined
          ? this._toInt(req.body.tipo_perfil_id, null)
          : this._toInt(atual.tipo_perfil_id, null);

      let tipoResolvido = req.body.tipo !== undefined ? req.body.tipo || 'morador' : atual.tipo;

      if (
        req.body.tipo === undefined &&
        tipoPerfilIdNovo &&
        tipoPerfilIdNovo !== this._toInt(atual.tipo_perfil_id, null)
      ) {
        const perfilRow = await postgres.query(
          `SELECT nome FROM "condominio-bh".tb_sgw_perfil WHERE id = :id LIMIT 1`,
          { replacements: { id: tipoPerfilIdNovo }, type: QueryTypes.SELECT }
        );
        if (perfilRow && perfilRow.length > 0) {
          tipoResolvido = this._normalizarPerfil(perfilRow[0].nome);
        }
      }

      let apartamentoFinal =
        req.body.apartamento !== undefined ? req.body.apartamento || null : atual.apartamento;
      let blocoFinal = req.body.bloco !== undefined ? req.body.bloco || null : atual.bloco;
      let idUnidadePredioNovo = this._toInt(atual.id_unidade_predio, null);

      if (req.body.id_unidade !== undefined) {
        const idUnidadeInformado = this._toInt(req.body.id_unidade, null);
        if (idUnidadeInformado) {
          const unidadeRow = await postgres.query(
            `SELECT id, bloco, unidades_bloco FROM "condominio-bh".tb_condominios_unidades
              WHERE id = :id AND id_condominio = :id_condominio
              LIMIT 1`,
            {
              replacements: { id: idUnidadeInformado, id_condominio: idCondominioToken },
              type: QueryTypes.SELECT
            }
          );
          if (!unidadeRow || unidadeRow.length === 0) {
            return res.status(422).json({
              message: 'id_unidade inválido para este condomínio.'
            });
          }
          idUnidadePredioNovo = idUnidadeInformado;
          apartamentoFinal = unidadeRow[0].unidades_bloco;
          blocoFinal = String(unidadeRow[0].bloco);
        } else {
          idUnidadePredioNovo = null;
        }
      } else if (
        (req.body.apartamento !== undefined || req.body.bloco !== undefined) &&
        apartamentoFinal &&
        blocoFinal
      ) {
        const unidadeRow = await postgres.query(
          `SELECT id FROM "condominio-bh".tb_condominios_unidades
            WHERE id_condominio = :id_condominio
              AND unidades_bloco = :apartamento
              AND bloco = :bloco
            LIMIT 1`,
          {
            replacements: {
              id_condominio: idCondominioToken,
              apartamento: String(apartamentoFinal).trim(),
              bloco: this._toInt(blocoFinal, null)
            },
            type: QueryTypes.SELECT
          }
        );
        idUnidadePredioNovo = unidadeRow && unidadeRow.length > 0 ? this._toInt(unidadeRow[0].id, null) : null;
      }

      const update = await postgres.query(
        `UPDATE "condominio-bh"."tb-usuarios"
            SET nome = :nome,
                sobrenome = :sobrenome,
                cpf = :cpf,
                email = :email,
                telefone = :telefone,
                data_nascimento = :data_nascimento,
                genero = :genero,
                tipo_morador = :tipo_morador,
                tipo_perfil_id = :tipo_perfil_id,
                tipo = :tipo,
                status = :status,
                senha_hash = :senha_hash,
                endereco_logradouro = :endereco_logradouro,
                endereco_numero = :endereco_numero,
                endereco_complemento = :endereco_complemento,
                endereco_bairro = :endereco_bairro,
                endereco_cidade = :endereco_cidade,
                endereco_uf = :endereco_uf,
                endereco_cep = :endereco_cep,
                apartamento = :apartamento,
                bloco = :bloco,
                id_unidade_predio = :id_unidade_predio,
                observacoes = :observacoes,
                path_avatar = :path_avatar,
                updated_at = now()
          WHERE id = :id
            AND id_condominio = :id_condominio
        RETURNING id, id_condominio, nome, sobrenome, cpf, email, telefone, path_avatar, tipo_morador, tipo_perfil_id, tipo, status, apartamento, bloco, id_unidade_predio, created_at, updated_at`,
        {
          replacements: {
            id: idUsuario,
            id_condominio: idCondominioToken,
            nome,
            sobrenome: req.body.sobrenome !== undefined ? sobrenome || null : atual.sobrenome,
            cpf: cpfNormalizado,
            email: emailNormalizado,
            telefone: req.body.telefone !== undefined ? req.body.telefone || null : atual.telefone,
            data_nascimento:
              req.body.data_nascimento !== undefined
                ? req.body.data_nascimento || null
                : atual.data_nascimento,
            genero: req.body.genero !== undefined ? req.body.genero || null : atual.genero,
            tipo_morador:
              req.body.tipo_morador !== undefined
                ? req.body.tipo_morador || null
                : atual.tipo_morador,
            tipo_perfil_id:
              req.body.tipo_perfil_id !== undefined
                ? this._toInt(req.body.tipo_perfil_id, null)
                : this._toInt(atual.tipo_perfil_id, null),
            tipo: tipoResolvido,
            status: req.body.status !== undefined ? req.body.status || 'ativo' : atual.status,
            senha_hash,
            endereco_logradouro:
              req.body.endereco_logradouro !== undefined
                ? req.body.endereco_logradouro || null
                : atual.endereco_logradouro,
            endereco_numero:
              req.body.endereco_numero !== undefined
                ? req.body.endereco_numero || null
                : atual.endereco_numero,
            endereco_complemento:
              req.body.endereco_complemento !== undefined
                ? req.body.endereco_complemento || null
                : atual.endereco_complemento,
            endereco_bairro:
              req.body.endereco_bairro !== undefined
                ? req.body.endereco_bairro || null
                : atual.endereco_bairro,
            endereco_cidade:
              req.body.endereco_cidade !== undefined
                ? req.body.endereco_cidade || null
                : atual.endereco_cidade,
            endereco_uf:
              req.body.endereco_uf !== undefined ? req.body.endereco_uf || null : atual.endereco_uf,
            endereco_cep:
              req.body.endereco_cep !== undefined ? req.body.endereco_cep || null : atual.endereco_cep,
            apartamento: apartamentoFinal,
            bloco: blocoFinal,
            id_unidade_predio: idUnidadePredioNovo,
            observacoes:
              req.body.observacoes !== undefined ? req.body.observacoes || null : atual.observacoes,
            path_avatar:
              req.body.path_avatar !== undefined ? req.body.path_avatar || null : atual.path_avatar
          }
        }
      );

      return res.status(200).json({
        message: 'Usuário atualizado com sucesso.',
        data: this._anexarAvatarUrlUsuario(req, update[0][0])
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao editar usuário.',
        detail: error.message
      });
    }
  }

  async buscarUsuarioPorId(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar usuário.'
        });
      }

      const idUsuario = this._toInt(req.params.id, null);
      if (!idUsuario) {
        return res.status(400).json({ message: 'Id do usuário inválido.' });
      }

      const usuario = await postgres.query(
        `SELECT
            tu.id,
            tu.id_condominio,
            tc.nome AS nome_condominio,
            tc.escrita_bloco,
            tc.qtde_ap_bloco,
            tc.modelo_fatura,
            tc.qtde_blocos,
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.path_avatar,
            tu.telefone,
            tu.tipo_morador,
            tu.data_nascimento,
            tu.genero,
            tu.tipo_perfil_id,
            tu.tipo,
            tu.status,
            tu.endereco_logradouro,
            tu.endereco_numero,
            tu.endereco_complemento,
            tu.endereco_bairro,
            tu.endereco_cidade,
            tu.endereco_uf,
            tu.endereco_cep,
            tu.apartamento,
            tu.bloco,
            tu.id_unidade_predio,
            tu.observacoes,
            tu.created_at,
            tu.updated_at
          FROM "condominio-bh"."tb-usuarios" tu
          LEFT JOIN "condominio-bh"."tb-condominios" tc
            ON tc.id = tu.id_condominio
          WHERE tu.id = :id
            AND tu.id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idUsuario,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuario || usuario.length === 0) {
        return res.status(404).json({
          message: 'Usuário não encontrado para este condomínio.'
        });
      }

      const usuarioData = usuario[0];
      const avatarUrl = buildAvatarProxyUrl(req, usuarioData.id, usuarioData.path_avatar);

      return res.status(200).json({
        data: {
          ...usuarioData,
          avatar_url: avatarUrl
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar usuário.',
        detail: error.message
      });
    }
  }

  async baixarAvatarUsuario(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar avatar.'
        });
      }

      const idUsuario = this._toInt(req.params.id, null);
      if (!idUsuario) {
        return res.status(400).json({ message: 'Id do usuário inválido.' });
      }

      const usuarioRows = await postgres.query(
        `SELECT id, path_avatar
           FROM "condominio-bh"."tb-usuarios"
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idUsuario,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuarioRows || usuarioRows.length === 0) {
        return res.status(404).json({
          message: 'Usuário não encontrado para este condomínio.'
        });
      }

      const pathAvatar = this._normalizarTextoOuNull(usuarioRows[0].path_avatar);
      if (!pathAvatar) {
        return res.status(404).json({
          message: 'Usuário não possui avatar cadastrado.'
        });
      }

      const blobUrl = resolveBlobUrl(pathAvatar);
      if (!blobUrl) {
        return res.status(500).json({
          message: 'Falha ao resolver URL do avatar no blob privado.'
        });
      }

      const blobToken = getBlobReadToken();
      if (!blobToken) {
        return res.status(500).json({
          message: 'Token do Vercel Blob não configurado no backend para leitura de avatar.'
        });
      }

      const blobResponse = await fetch(blobUrl, {
        headers: {
          Authorization: `Bearer ${blobToken}`
        }
      });

      if (!blobResponse.ok) {
        if (blobResponse.status === 404) {
          return res.status(404).json({ message: 'Avatar não encontrado no blob.' });
        }

        return res.status(502).json({
          message: 'Falha ao ler avatar no blob privado.',
          detail: `Blob retornou status ${blobResponse.status}.`
        });
      }

      const payload = await blobResponse.buffer();
      const contentType = blobResponse.headers.get('content-type') || 'application/octet-stream';
      const cacheControl = blobResponse.headers.get('cache-control') || 'private, max-age=300';
      const etag = blobResponse.headers.get('etag');

      res.set('Content-Type', contentType);
      res.set('Cache-Control', cacheControl);
      if (etag) {
        res.set('ETag', etag);
      }

      return res.status(200).send(payload);
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar avatar do usuário.',
        detail: error.message
      });
    }
  }

  async uploadAvatarUsuario(req, res) {
    try {
      const arquivoRecebido =
        req.files?.path_avatar?.[0] ||
        req.files?.foto?.[0] ||
        req.files?.arquivo?.[0] ||
        req.file ||
        null;

      if (!arquivoRecebido || !arquivoRecebido.buffer) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo de avatar não enviado. Use path_avatar, foto ou arquivo.'
        });
      }

      const idUsuario = this._toInt(
        req.body.id_usuario ?? req.body.usuario_id ?? req.query.id_usuario ?? req.query.usuario_id,
        null
      );
      if (!idUsuario) {
        return res.status(400).json({
          success: false,
          message: 'Campo id_usuario (ou usuario_id) é obrigatório.'
        });
      }

      const idCondominio = this._toInt(
        req.id_condominio ??
        req.body.id_condominio ??
        req.body.condominio_id ??
        req.query.id_condominio ??
        req.query.condominio_id,
        null
      );

      if (!idCondominio) {
        return res.status(400).json({
          success: false,
          message: 'Campo id_condominio (ou condominio_id) é obrigatório.'
        });
      }

      const usuarioRows = await postgres.query(
        `SELECT id, path_avatar
           FROM "condominio-bh"."tb-usuarios"
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idUsuario,
            id_condominio: idCondominio
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuarioRows || usuarioRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Usuário não encontrado para este condomínio.'
        });
      }

      const usuarioAtual = usuarioRows[0];

      const extByOriginalName = path.extname(String(arquivoRecebido.originalname || '')).replace('.', '').toLowerCase();
      const extByMime = String(arquivoRecebido.mimetype || '')
        .split('/')
        .pop()
        .split(';')[0]
        .trim()
        .toLowerCase();
      const extensao = extByOriginalName || extByMime || 'jpg';

      const ambiente =
        this._normalizarTextoOuNull(
          process.env.BLOB_UPLOAD_ENV || process.env.BLOB_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV
        ) || 'dev';

      const avatarPathAtual = String(usuarioAtual.path_avatar || '');
      const versaoAtualMatch = avatarPathAtual.match(/\/avatar\/v(\d+)\.[^\/?#]+(?:[?#].*)?$/i);
      const versaoAtualNumero = versaoAtualMatch ? this._toInt(versaoAtualMatch[1], 0) : 0;
      const proximaVersaoNumero = (Number.isFinite(versaoAtualNumero) ? versaoAtualNumero : 0) + 1;
      const versao = `v${proximaVersaoNumero}`;
      const blobPath = `${ambiente}/condominios/${idCondominio}/usuarios/${idUsuario}/avatar/${versao}.${extensao}`;

      const blobAccess = 'private';

      const tokenSources = [
        {
          name: 'BLOB_PRIVATE_READ_WRITE_TOKEN',
          value: this._normalizarTextoOuNull(process.env.BLOB_PRIVATE_READ_WRITE_TOKEN)
        },
        {
          name: 'EMORADOR_READ_WRITE_TOKEN',
          value: this._normalizarTextoOuNull(process.env.EMORADOR_READ_WRITE_TOKEN)
        },
        {
          name: 'BLOB_READ_WRITE_TOKEN',
          value: this._normalizarTextoOuNull(process.env.BLOB_READ_WRITE_TOKEN)
        },
        {
          name: 'VERCEL_BLOB_READ_WRITE_TOKEN',
          value: this._normalizarTextoOuNull(process.env.VERCEL_BLOB_READ_WRITE_TOKEN)
        }
      ];

      const selectedTokenEntry = tokenSources.find((item) => item.value);
      const token = selectedTokenEntry?.value || null;
      const tokenSourceName = selectedTokenEntry?.name || 'nenhuma';

      if (!token) {
        return res.status(500).json({
          success: false,
          message: 'Falha ao fazer upload do avatar.',
          detail:
            'Token do Vercel Blob não configurado. Defina BLOB_PRIVATE_READ_WRITE_TOKEN (preferencial) ou EMORADOR_READ_WRITE_TOKEN.'
        });
      }

      const uploadOptionsBase = {
        addRandomSuffix: false,
        contentType: arquivoRecebido.mimetype || undefined,
        token: token || undefined
      };

      let uploadResult;
      try {
        uploadResult = await put(blobPath, arquivoRecebido.buffer, {
          ...uploadOptionsBase,
          access: blobAccess
        });
      } catch (blobError) {
        const mensagemBlob = String(blobError?.message || '');
        const exigePublico = /access must be "public"/i.test(mensagemBlob);

        if (exigePublico) {
          throw new Error(
            `Store do token exige acesso public, mas o endpoint de avatar está configurado para private. Token selecionado via ${tokenSourceName}. Confira se esse token pertence ao mesmo store private.`
          );
        }

        throw blobError;
      }

      const pathAvatarFinal = uploadResult?.url || uploadResult?.pathname || blobPath;

      await postgres.query(
        `UPDATE "condominio-bh"."tb-usuarios"
            SET path_avatar = :path_avatar,
                updated_at = now()
          WHERE id = :id
            AND id_condominio = :id_condominio`,
        {
          replacements: {
            id: idUsuario,
            id_condominio: idCondominio,
            path_avatar: pathAvatarFinal
          },
          type: QueryTypes.UPDATE
        }
      );

      return res.status(200).json({
        success: true,
        path_avatar: pathAvatarFinal,
        avatar_url: buildAvatarProxyUrl(req, idUsuario, pathAvatarFinal),
        message: 'Foto atualizada com sucesso'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Falha ao fazer upload do avatar.',
        detail: error.message
      });
    }
  }

  async criarEspaco(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para criar espaço.'
        });
      }

      const {
        nome,
        descricao,
        localizacao,
        capacidade,
        ativo,
        exige_aprovacao,
        permite_convidados,
        antecedencia_min_horas,
        periodo_manha,
        periodo_tarde,
        periodo_noite,
        segunda,
        terca,
        quarta,
        quinta,
        sexta,
        sabado,
        domingo,
        periodo_modo,
        taxa_reserva,
        max_res_unid_ano,
        max_dias_permite_agendar,
        bloqueia_outras_salas
      } = req.body;

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh".tb_espaco (
          id_condominio,
          nome,
          descricao,
          localizacao,
          capacidade,
          ativo,
          exige_aprovacao,
          permite_convidados,
          antecedencia_min_horas,
          periodo_manha,
          periodo_tarde,
          periodo_noite,
          segunda,
          terca,
          quarta,
          quinta,
          sexta,
          sabado,
          domingo,
          periodo_modo,
          taxa_reserva,
          max_res_unid_ano,
          max_dias_permite_agendar,
          sala_bloqueia_outras,
          created_at,
          updated_at
        ) VALUES (
          :id_condominio,
          :nome,
          :descricao,
          :localizacao,
          :capacidade,
          :ativo,
          :exige_aprovacao,
          :permite_convidados,
          :antecedencia_min_horas,
          :periodo_manha,
          :periodo_tarde,
          :periodo_noite,
          :segunda,
          :terca,
          :quarta,
          :quinta,
          :sexta,
          :sabado,
          :domingo,
          :periodo_modo,
          :taxa_reserva,
          :max_res_unid_ano,
          :max_dias_permite_agendar,
          :sala_bloqueia_outras,
          now(),
          now()
        )
        RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominioToken,
            nome,
            descricao: descricao || null,
            localizacao: localizacao || null,
            capacidade: capacidade || null,
            ativo: typeof ativo === 'boolean' ? ativo : true,
            exige_aprovacao: typeof exige_aprovacao === 'boolean' ? exige_aprovacao : false,
            permite_convidados: typeof permite_convidados === 'boolean' ? permite_convidados : true,
            antecedencia_min_horas: antecedencia_min_horas || null,
            periodo_manha: periodo_manha ?? 0,
            periodo_tarde: periodo_tarde ?? 0,
            periodo_noite: periodo_noite ?? 0,
            segunda: segunda ?? 0,
            terca: terca ?? 0,
            quarta: quarta ?? 0,
            quinta: quinta ?? 0,
            sexta: sexta ?? 0,
            sabado: sabado ?? 0,
            domingo: domingo ?? 0,
            periodo_modo: periodo_modo || null,
            taxa_reserva: taxa_reserva || null,
            max_res_unid_ano: max_res_unid_ano ?? null,
            max_dias_permite_agendar: max_dias_permite_agendar ?? null,
            sala_bloqueia_outras: bloqueia_outras_salas ?? 0
          }
        }
      );

      return res.status(201).json({
        message: 'Espaço cadastrado com sucesso.',
        data: insert[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao cadastrar espaço.',
        detail: error.message
      });
    }
  }

  async editarEspaco(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para editar espaço.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id inválido.' });
      }

      const {
        nome,
        descricao,
        localizacao,
        capacidade,
        ativo,
        exige_aprovacao,
        permite_convidados,
        antecedencia_min_horas,
        periodo_manha,
        periodo_tarde,
        periodo_noite,
        segunda,
        terca,
        quarta,
        quinta,
        sexta,
        sabado,
        domingo,
        periodo_modo,
        taxa_reserva,
        max_res_unid_ano,
        max_dias_permite_agendar,
        bloqueia_outras_salas
      } = req.body;

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_espaco
            SET nome = :nome,
                descricao = :descricao,
                localizacao = :localizacao,
                capacidade = :capacidade,
                ativo = :ativo,
                exige_aprovacao = :exige_aprovacao,
                permite_convidados = :permite_convidados,
                antecedencia_min_horas = :antecedencia_min_horas,
                    periodo_manha = :periodo_manha,
                    periodo_tarde = :periodo_tarde,
                    periodo_noite = :periodo_noite,
                segunda = :segunda,
                terca = :terca,
                quarta = :quarta,
                quinta = :quinta,
                sexta = :sexta,
                sabado = :sabado,
                domingo = :domingo,
                periodo_modo = :periodo_modo,
                taxa_reserva = :taxa_reserva,
                max_res_unid_ano = :max_res_unid_ano,
                max_dias_permite_agendar = :max_dias_permite_agendar,
                sala_bloqueia_outras = :sala_bloqueia_outras,
                updated_at = now()
          WHERE id = :id
            AND id_condominio = :id_condominio
        RETURNING *`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken,
            nome,
            descricao: descricao || null,
            localizacao: localizacao || null,
            capacidade: capacidade || null,
            ativo: typeof ativo === 'boolean' ? ativo : true,
            exige_aprovacao: typeof exige_aprovacao === 'boolean' ? exige_aprovacao : false,
            permite_convidados: typeof permite_convidados === 'boolean' ? permite_convidados : true,
            antecedencia_min_horas: antecedencia_min_horas || null,
            periodo_manha: periodo_manha ?? 0,
            periodo_tarde: periodo_tarde ?? 0,
            periodo_noite: periodo_noite ?? 0,
            segunda: segunda ?? 0,
            terca: terca ?? 0,
            quarta: quarta ?? 0,
            quinta: quinta ?? 0,
            sexta: sexta ?? 0,
            sabado: sabado ?? 0,
            domingo: domingo ?? 0,
            periodo_modo: periodo_modo || null,
            taxa_reserva: taxa_reserva || null,
            max_res_unid_ano: max_res_unid_ano ?? null,
            max_dias_permite_agendar: max_dias_permite_agendar ?? null,
            sala_bloqueia_outras: bloqueia_outras_salas ?? 0
          }
        }
      );

      if (!update[0] || update[0].length === 0) {
        return res.status(404).json({ message: 'Espaço não encontrado.' });
      }

      return res.status(200).json({
        message: 'Espaço atualizado com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao editar espaço.',
        detail: error.message
      });
    }
  }

  async buscarEspacoPorId(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar espaço.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id inválido.' });
      }

      const espaco = await postgres.query(
        `SELECT *
           FROM "condominio-bh".tb_espaco
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: { id, id_condominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      if (!espaco || espaco.length === 0) {
        return res.status(404).json({ message: 'Espaço não encontrado.' });
      }

      return res.status(200).json({ data: espaco[0] });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar espaço.',
        detail: error.message
      });
    }
  }

  async listarEspacosPaginado(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar espaços.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 10), 1), 100);
      const offset = (page - 1) * pageSize;
      const liDados = String(req.query.liDados || '').trim().toLowerCase();
      const listarTodosDados = liDados === 'all';
      const orderField = req.query.orderBy === 'nome' ? 'nome' : 'id';
      const orderClause = orderField === 'nome' ? 'nome ASC' : 'id DESC';
      const filtroAtivo =
        typeof req.query.ativo === 'boolean'
          ? req.query.ativo
          : typeof req.query.ativo === 'string'
            ? ['true', '1'].includes(req.query.ativo.toLowerCase())
            : null;

      const whereParts = [];
      const baseReplacements = {};
      if (!ehAdmin) {
        whereParts.push('e.id_condominio = :idCondominio');
        baseReplacements.idCondominio = idCondominioToken;
      }
      if (filtroAtivo !== null) {
        whereParts.push('e.ativo = :ativo');
        baseReplacements.ativo = filtroAtivo;
      }
      const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : '1 = 1';

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_espaco e
           LEFT JOIN "condominio-bh"."tb-condominios" c
             ON c.id = e.id_condominio
          WHERE ${whereClause}`,
        {
          replacements: baseReplacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT e.*, c.nome AS nome_condominio,
            c.escrita_bloco,
            c.qtde_ap_bloco,
            c.modelo_fatura,
            c.qtde_blocos
           FROM "condominio-bh".tb_espaco e
           LEFT JOIN "condominio-bh"."tb-condominios" c
             ON c.id = e.id_condominio
          WHERE ${whereClause}
          ORDER BY ${orderClause}
          LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...baseReplacements,
            limit: pageSize,
            offset
          },
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar espaços.',
        detail: error.message
      });
    }
  }

  async listarSalasReservadas(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const ehAdmin = idPerfilToken === 1;
      const ehMorador = idPerfilToken === 2;

      if (!ehAdmin && !idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar reservas.'
        });
      }

      if (ehMorador && !idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuário para listar reservas do morador.'
        });
      }

      const hasPageParam = req.query.page !== undefined;
      const hasPageSizeParam = req.query.pageSize !== undefined;
      const usePagination = hasPageParam || hasPageSizeParam;
      const liDados = String(req.query.liDados || '').trim().toLowerCase();
      const listarTodosDados = liDados === 'all';
      const dataInicioRaw = req.query.data_inicio;
      const dataFimRaw = req.query.data_fim;
      const usarPeriodo = Boolean(dataInicioRaw || dataFimRaw);

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 10), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['1 = 1'];
      const baseReplacements = {};

      const idCondominioFiltro = this._toInt(req.query.id_condominio, null);
      if (idCondominioFiltro && !ehAdmin && idCondominioFiltro !== idCondominioToken) {
        return res.status(403).json({
          message: 'Sem permissão para consultar reservas de outro condomínio.'
        });
      }
      if (!ehAdmin || idCondominioFiltro) {
        whereParts.push('ea.id_condominio = :idCondominio');
        baseReplacements.idCondominio = idCondominioFiltro || idCondominioToken;
      }

      // Para calendário por período, morador precisa enxergar a ocupação do espaço.
      if (ehMorador && !listarTodosDados && !usarPeriodo) {
        whereParts.push('ea.id_usuario = :id_usuario_token');
        baseReplacements.id_usuario_token = idUsuarioToken;
      }

      const idEspacoFiltro = this._toInt(req.query.id_espaco, null);
      if (idEspacoFiltro) {
        whereParts.push('ea.id_espaco = :id_espaco');
        baseReplacements.id_espaco = idEspacoFiltro;
      }

      const aba = req.query.aba ? String(req.query.aba).trim().toLowerCase() : null;
      let statusList = [];

      if (req.query.status) {
        statusList = String(req.query.status)
          .split(',')
          .map((item) => this._toInt(item.trim(), null))
          .filter((item) => item !== null && item > 0);
      } else if (aba === 'em_andamento') {
        statusList = [1, 2];
      } else if (aba === 'concluidos') {
        statusList = [3, 4, 5];
      }

      if (statusList.length === 1) {
        whereParts.push('(ea.status) = :status');
        baseReplacements.status = Number(statusList[0]);
      } else if (statusList.length > 1) {
        whereParts.push('(ea.status) IN (:status_list)');
        baseReplacements.status_list = statusList.map((item) => Number(item));
      }

      if (usarPeriodo) {
        if (!dataInicioRaw || !dataFimRaw) {
          return res.status(400).json({
            message: 'Informe os parâmetros data_inicio e data_fim para filtrar por período.'
          });
        }

        const dataInicio = this._parseDataAgendamento(dataInicioRaw);
        const dataFim = this._parseDataAgendamento(dataFimRaw);

        if (!dataInicio || !dataFim) {
          return res.status(400).json({
            message: 'Parâmetros data_inicio/data_fim inválidos. Use ISO 8601 ou dd/mm/aaaa.'
          });
        }

        if (dataInicio.getTime() > dataFim.getTime()) {
          return res.status(400).json({
            message: 'Parâmetro data_inicio não pode ser maior que data_fim.'
          });
        }

        baseReplacements.data_inicio = dataInicio.toISOString().slice(0, 10);
        baseReplacements.data_fim = dataFim.toISOString().slice(0, 10);
        whereParts.push('ea.data_agendamento::date BETWEEN :data_inicio AND :data_fim');

        if (!req.query.status && !aba) {
          whereParts.push('(ea.status) IN (1, 2, 3, 4, 5)');
        }
      }

      if (req.query.data_agendamento) {
        const dataFiltro = this._parseDataAgendamento(req.query.data_agendamento);
        if (!dataFiltro) {
          return res.status(400).json({
            message: 'Parâmetro data_agendamento inválido. Use ISO 8601 ou dd/mm/aaaa.'
          });
        }

        const dataFiltroIso = dataFiltro.toISOString().slice(0, 10);
        whereParts.push('ea.data_agendamento::date = :data_agendamento');
        baseReplacements.data_agendamento = dataFiltroIso;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_espaco_agenda ea
          WHERE ${whereClause}`,
        {
          replacements: baseReplacements,
          type: QueryTypes.SELECT
        }
      );

      const selectBaseQuery = `SELECT
            tu.nome,
        tu.email,
            tu.apartamento,
            tu.bloco,
			      ea.*,
            ea.id_usuario_cadastro,
            tuc.nome AS usuario_cadastro_nome,
            tuc.sobrenome AS usuario_cadastro_sobrenome,
            TRIM(COALESCE(tuc.nome, '') || ' ' || COALESCE(tuc.sobrenome, '')) AS usuario_cadastro_nome_completo,
            tuc.tipo_perfil_id AS usuario_cadastro_tipo_perfil_id,
            CASE
              WHEN ea.id_usuario_cadastro IS NOT NULL
                AND COALESCE(tuc.tipo_perfil_id::text, '0') = '3'
              THEN true
              ELSE false
            END AS reserva_feita_por_sindico,
            CASE
              WHEN ea.id_usuario_cadastro IS NOT NULL
                AND COALESCE(tuc.tipo_perfil_id::text, '0') = '3'
              THEN 'sindico'
              ELSE 'morador'
            END AS origem_reserva,
            c.nome AS nome_condominio,
              c.escrita_bloco,
              c.qtde_ap_bloco,
              c.modelo_fatura,
              c.qtde_blocos,
            e.nome AS espaco_nome,
            e.localizacao AS espaco_localizacao,
            e.sala_bloqueia_outras AS bloqueia_outras_salas,
              COALESCE(ea.taxa_reserva, e.taxa_reserva) AS taxa_reserva,
            tt.descricao_status 
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_espaco e
             ON e.id = ea.id_espaco
          inner join  "condominio-bh"."tb-usuarios" tu 
            on ea.id_usuario = tu.id
          left join "condominio-bh"."tb-usuarios" tuc
            on tuc.id::text = ea.id_usuario_cadastro::text
          left join "condominio-bh"."tb-condominios" c
            on c.id = ea.id_condominio
          LEFT JOIN "condominio-bh".tb_status_tratamento tt
            ON ea.status = tt.id
          WHERE ${whereClause}
          ORDER BY COALESCE(ea.data_agendamento, ea.created_at) DESC, ea.id DESC`;

      const data = usePagination
        ? await postgres.query(
            `${selectBaseQuery}
          LIMIT :limit OFFSET :offset`,
            {
              replacements: {
                ...baseReplacements,
                limit: pageSize,
                offset
              },
              type: QueryTypes.SELECT
            }
          )
        : await postgres.query(selectBaseQuery, {
            replacements: baseReplacements,
            type: QueryTypes.SELECT
          });

      const podeVisualizarDadosMorador = await this._podeVisualizarDadosMorador(req);
      const dataResposta = podeVisualizarDadosMorador
        ? data
        : ehMorador
          ? data.map((row) => {
              const ehDoProprioMorador = this._toInt(row.id_usuario, null) === idUsuarioToken;

              if (ehDoProprioMorador) {
                return row;
              }

              return {
                ...row,
                nome: '****',
                email: '****',
                apartamento: '****',
                bloco: '****'
              };
            })
          : data.map((row) => ({
              ...row,
              nome: '****',
              email: '****',
              apartamento: '****',
              bloco: '****'
            }));

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      if (!usePagination) {
        return res.status(200).json({
          total,
          data: dataResposta
        });
      }

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data: dataResposta
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar reservas de salas.',
        detail: error.message
      });
    }
  }

  async listarReservasMesCorrente(req, res) {
    try {
      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const idCondominioToken = this._toInt(req.id_condominio, null);
      const idUsuarioToken = this._toInt(req.idcliente, null);
      const ehMorador = idPerfilToken === 2;

      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar reservas do mês corrente.'
        });
      }

      if (ehMorador && !idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuário para listar reservas do mês corrente do morador.'
        });
      }

      const whereParts = ['ea.id_condominio = :idCondominio'];
      const replacements = { idCondominio: idCondominioToken };

      const dataInicioRaw = req.query.data_inicio;
      const dataFimRaw = req.query.data_fim;
      const usarPeriodo = Boolean(dataInicioRaw || dataFimRaw);

      if (usarPeriodo) {
        if (!dataInicioRaw || !dataFimRaw) {
          return res.status(400).json({
            message: 'Informe os parâmetros data_inicio e data_fim para filtrar por período.'
          });
        }

        const dataInicio = this._parseDataAgendamento(dataInicioRaw);
        const dataFim = this._parseDataAgendamento(dataFimRaw);

        if (!dataInicio || !dataFim) {
          return res.status(400).json({
            message: 'Parâmetros data_inicio/data_fim inválidos. Use ISO 8601 ou dd/mm/aaaa.'
          });
        }

        if (dataInicio.getTime() > dataFim.getTime()) {
          return res.status(400).json({
            message: 'Parâmetro data_inicio não pode ser maior que data_fim.'
          });
        }

        replacements.data_inicio = dataInicio.toISOString().slice(0, 10);
        replacements.data_fim = dataFim.toISOString().slice(0, 10);
        whereParts.push('ea.data_agendamento::date BETWEEN :data_inicio AND :data_fim');
      }

      const whereClause = whereParts.join(' AND ');

      const data = await postgres.query(
        `SELECT
            ea.id_usuario,
            ea.id_usuario_cadastro,
            tu.nome AS nome_usuario,
            e.nome AS sala,
            tu.apartamento,
            tu.bloco,
            TRIM(COALESCE(tuc.nome, '') || ' ' || COALESCE(tuc.sobrenome, '')) AS usuario_cadastro_nome_completo,
            CASE
              WHEN ea.id_usuario_cadastro IS NOT NULL
                AND COALESCE(tuc.tipo_perfil_id::text, '0') = '3'
              THEN true
              ELSE false
            END AS reserva_feita_por_sindico,
            CASE
              WHEN ea.id_usuario_cadastro IS NOT NULL
                AND COALESCE(tuc.tipo_perfil_id::text, '0') = '3'
              THEN 'sindico'
              ELSE 'morador'
            END AS origem_reserva,
            tt.descricao_status AS status_reserva,
            ea.data_agendamento::date AS data_reserva
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_espaco e
             ON e.id = ea.id_espaco
          INNER JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = ea.id_usuario
          LEFT JOIN "condominio-bh"."tb-usuarios" tuc
             ON tuc.id::text = ea.id_usuario_cadastro::text
           LEFT JOIN "condominio-bh".tb_status_tratamento tt
             ON tt.id = ea.status
          WHERE ${whereClause}
          ORDER BY ea.data_agendamento::date ASC, ea.id ASC`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const podeVisualizarDadosMorador = await this._podeVisualizarDadosMorador(req);
      const dataResposta = podeVisualizarDadosMorador
        ? data.map(({ id_usuario, ...row }) => row)
        : ehMorador
          ? data.map(({ id_usuario, ...row }) => {
              const ehDoProprioMorador = this._toInt(id_usuario, null) === idUsuarioToken;

              if (ehDoProprioMorador) {
                return row;
              }

              return {
                ...row,
                nome_usuario: '****',
                apartamento: '****',
                bloco: '****'
              };
            })
          : data.map(({ id_usuario, ...row }) => ({
              ...row,
              nome_usuario: '****',
              apartamento: '****',
              bloco: '****'
            }));
          //  AND ea.data_agendamento::date >= date_trunc('month', CURRENT_DATE)::date
          //   AND ea.data_agendamento::date < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
   
      return res.status(200).json({
        total: dataResposta.length,
        data: dataResposta
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar reservas do mês corrente.',
        detail: error.message
      });
    }
  }

  async listarMinhasReservas(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar minhas reservas.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      if (!idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuário para listar minhas reservas.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 10), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['ea.id_condominio = :idCondominio', 'ea.id_usuario = :id_usuario'];
      const baseReplacements = {
        idCondominio: idCondominioToken,
        id_usuario: idUsuarioToken
      };

      const idEspacoFiltro = this._toInt(req.query.id_espaco, null);
      if (idEspacoFiltro) {
        whereParts.push('ea.id_espaco = :id_espaco');
        baseReplacements.id_espaco = idEspacoFiltro;
      }

      const aba = req.query.aba ? String(req.query.aba).trim().toLowerCase() : null;
      let statusList = [];

      if (req.query.status) {
        statusList = String(req.query.status)
          .split(',')
          .map((item) => this._toInt(item.trim(), null))
          .filter((item) => item !== null && item > 0);
      } else if (aba === 'em_andamento') {
        statusList = [1, 2];
      } else if (aba === 'concluidos') {
        statusList = [3, 4, 5];
      }

      if (statusList.length === 1) {
        whereParts.push('(ea.status) = :status');
        baseReplacements.status = Number(statusList[0]);
      } else if (statusList.length > 1) {
        whereParts.push('(ea.status) IN (:status_list)');
        baseReplacements.status_list = statusList.map((item) => Number(item));
      }

      if (req.query.data_agendamento) {
        const dataFiltro = this._parseDataAgendamento(req.query.data_agendamento);
        if (!dataFiltro) {
          return res.status(400).json({
            message: 'Parâmetro data_agendamento inválido. Use ISO 8601 ou dd/mm/aaaa.'
          });
        }

        const dataFiltroIso = dataFiltro.toISOString().slice(0, 10);
        whereParts.push('ea.data_agendamento::date = :data_agendamento');
        baseReplacements.data_agendamento = dataFiltroIso;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_espaco_agenda ea
          WHERE ${whereClause}`,
        {
          replacements: baseReplacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            ea.*,
            ea.id_usuario_cadastro,
            tuc.nome AS usuario_cadastro_nome,
            tuc.sobrenome AS usuario_cadastro_sobrenome,
            TRIM(COALESCE(tuc.nome, '') || ' ' || COALESCE(tuc.sobrenome, '')) AS usuario_cadastro_nome_completo,
            tuc.tipo_perfil_id AS usuario_cadastro_tipo_perfil_id,
            CASE
              WHEN ea.id_usuario_cadastro IS NOT NULL
                AND COALESCE(tuc.tipo_perfil_id::text, '0') = '3'
              THEN true
              ELSE false
            END AS reserva_feita_por_sindico,
            CASE
              WHEN ea.id_usuario_cadastro IS NOT NULL
                AND COALESCE(tuc.tipo_perfil_id::text, '0') = '3'
              THEN 'sindico'
              ELSE 'morador'
            END AS origem_reserva,
            e.nome AS espaco_nome,
            e.localizacao AS espaco_localizacao,
            tt.descricao_status 
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_espaco e
             ON e.id = ea.id_espaco
          LEFT JOIN "condominio-bh"."tb-usuarios" tuc
             ON tuc.id::text = ea.id_usuario_cadastro::text
          inner join  "condominio-bh"."tb_status_tratamento" tt
            on ea.status = tt.id     
          WHERE ${whereClause}
          ORDER BY COALESCE(ea.data_agendamento, ea.created_at) DESC, ea.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...baseReplacements,
            limit: pageSize,
            offset
          },
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar minhas reservas de salas.',
        detail: error.message
      });
    }
  }

  async agendarEspaco(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para agendar sala.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      if (!idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuário para agendar sala.'
        });
      }

      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehMorador = idPerfilToken === 2;

      const idUsuarioBody = this._toInt(
        req.body.usuario_id ?? req.body.id_usuario ?? req.body.solicitante_id,
        null
      );

      let idUsuarioReserva = idUsuarioToken;
      let idUsuarioCadastro = null;

      if (ehMorador) {
        idUsuarioReserva = idUsuarioToken;
        idUsuarioCadastro = null;
      } else {
        if (!idUsuarioBody) {
          return res.status(400).json({
            message: 'Campo usuario_id é obrigatório para agendamento feito por síndico/administrador.'
          });
        }

        idUsuarioReserva = idUsuarioBody;
        idUsuarioCadastro = idUsuarioToken;
      }

      const usuarioReservaRows = await postgres.query(
        `SELECT id, nome, email, apartamento, bloco
           FROM "condominio-bh"."tb-usuarios"
          WHERE id = :id_usuario
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id_usuario: idUsuarioReserva,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuarioReservaRows || usuarioReservaRows.length === 0) {
        return res.status(400).json({
          message: 'usuario_id inválido para este condomínio.'
        });
      }

      const idEspaco = this._toInt(req.params.id ?? req.body.id_espaco, null);
      if (!idEspaco) {
        return res.status(400).json({ message: 'Id do espaço inválido.' });
      }

      const espaco = await postgres.query(
        `SELECT id, nome, periodo_modo, taxa_reserva, max_res_unid_ano, max_dias_permite_agendar, sala_bloqueia_outras
           FROM "condominio-bh".tb_espaco
          WHERE id = :idEspaco
            AND id_condominio = :idCondominio
          LIMIT 1`,
        {
          replacements: { idEspaco, idCondominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      if (!espaco || espaco.length === 0) {
        return res.status(404).json({ message: 'Espaço não encontrado para este condomínio.' });
      }

      const taxaReservaAgenda =
        espaco[0].taxa_reserva === undefined || espaco[0].taxa_reserva === null
          ? null
          : Number(espaco[0].taxa_reserva);

      const periodo_manha = Math.max(this._toInt(req.body.periodo_manha, 0), 0) ? 1 : 0;
      const periodo_tarde = Math.max(this._toInt(req.body.periodo_tarde, 0), 0) ? 1 : 0;
      const periodo_noite = Math.max(this._toInt(req.body.periodo_noite, 0), 0) ? 1 : 0;

      if (periodo_manha + periodo_tarde + periodo_noite === 0) {
        return res.status(400).json({ message: 'Selecione ao menos um período para reservar.' });
      }

      let status = this._toInt(req.body.status_code, null);
      const statusRaw =
        req.body.status === undefined || req.body.status === null
          ? null
          : String(req.body.status).trim();

      if (!status && statusRaw) {
        const statusFromText = await postgres.query(
          `SELECT id
             FROM "condominio-bh".tb_status_tratamento
            WHERE lower(descricao_status) = lower(:descricao_status)
            LIMIT 1`,
          {
            replacements: { descricao_status: statusRaw },
            type: QueryTypes.SELECT
          }
        );

        if (statusFromText && statusFromText.length > 0) {
          status = this._toInt(statusFromText[0].id, null);
        }
      }

      if (!status) {
        status = 1;
      }

      const statusExists = await postgres.query(
        `SELECT id
           FROM "condominio-bh".tb_status_tratamento
          WHERE id = :id_status
          LIMIT 1`,
        {
          replacements: { id_status: status },
          type: QueryTypes.SELECT
        }
      );

      if (!statusExists || statusExists.length === 0) {
        return res.status(400).json({
          message: 'status_code inválido para tb_status_tratamento.'
        });
      }

      const observacoes = req.body.observacoes ? String(req.body.observacoes).trim() : null;
      const modo_sala = req.body.modo_sala ? String(req.body.modo_sala).trim() : null;
      const hasDataAgendamentoInput =
        req.body.data_agendamento !== undefined &&
        req.body.data_agendamento !== null &&
        String(req.body.data_agendamento).trim() !== '';
      const data_agendamento = this._parseDataAgendamento(req.body.data_agendamento);

      if (!hasDataAgendamentoInput) {
        return res.status(400).json({
          message: 'Campo data_agendamento é obrigatório para reservar sala.'
        });
      }

      if (!data_agendamento) {
        return res.status(400).json({
          message: 'Campo data_agendamento inválido. Use ISO 8601 ou dd/mm/aaaa.'
        });
      }

      const dataAgendamentoIso = data_agendamento.toISOString().slice(0, 10);
      const inicioDiaUtc = new Date(`${dataAgendamentoIso}T00:00:00.000Z`);
      const fimDiaUtc = new Date(`${dataAgendamentoIso}T00:00:00.000Z`);
      fimDiaUtc.setUTCDate(fimDiaUtc.getUTCDate() + 1);

      // Regra: max_dias_permite_agendar — data da reserva não pode ultrapassar hoje + N dias
      const maxDiasAgendar = this._toInt(espaco[0].max_dias_permite_agendar, null);
      if (maxDiasAgendar !== null && maxDiasAgendar >= 0) {
        const hoje = new Date();
        hoje.setUTCHours(0, 0, 0, 0);
        const dataLimite = new Date(hoje);
        dataLimite.setUTCDate(dataLimite.getUTCDate() + maxDiasAgendar);
        if (inicioDiaUtc > dataLimite) {
          return res.status(400).json({
            message: `Reserva permitida com no máximo ${maxDiasAgendar} dia(s) de antecedência.`
          });
        }
      }

      // Regra: max_res_unid_ano — limite de reservas ativas por usuário/ano neste espaço
      // Conta status 1 (Em andamento), 2 (Em Reserva) e 3 (Reservado)
      const maxResUnidAno = this._toInt(espaco[0].max_res_unid_ano, null);
      if (maxResUnidAno !== null && maxResUnidAno >= 0) {
        const anoAtual = new Date().getUTCFullYear();
        const [{ total }] = await postgres.query(
          `SELECT COUNT(*) AS total
             FROM "condominio-bh".tb_espaco_agenda
            WHERE id_espaco    = :id_espaco
              AND id_usuario   = :id_usuario
              AND id_condominio = :id_condominio
              AND status IN (1, 2, 3)
              AND EXTRACT(YEAR FROM data_agendamento AT TIME ZONE 'UTC') = :ano`,
          {
            replacements: {
              id_espaco: idEspaco,
              id_usuario: idUsuarioReserva,
              id_condominio: idCondominioToken,
              ano: anoAtual
            },
            type: QueryTypes.SELECT
          }
        );
        if (Number(total) >= maxResUnidAno) {
          return res.status(409).json({
            message: `Limite de ${maxResUnidAno} reserva(s) por ano para este espaço atingido.`
          });
        }
      }

      const espacoBloqueador = this._toInt(espaco[0].sala_bloqueia_outras, 0) === 1;

      if (espacoBloqueador) {
        const [{ total: totalReservasDia }] = await postgres.query(
          `SELECT COUNT(*) AS total
             FROM "condominio-bh".tb_espaco_agenda
            WHERE id_condominio = :id_condominio
              AND data_agendamento >= :data_agendamento_inicio
              AND data_agendamento <  :data_agendamento_fim
              AND status IN (1, 2, 3)`,
          {
            replacements: {
              id_condominio: idCondominioToken,
              data_agendamento_inicio: inicioDiaUtc,
              data_agendamento_fim: fimDiaUtc
            },
            type: QueryTypes.SELECT
          }
        );
        if (Number(totalReservasDia) > 0) {
          return res.status(409).json({
            message: 'Esta sala bloqueia todas as outras. Já existe reserva nesta data.'
          });
        }
      }

      const bloqueadorJaReservado = await postgres.query(
        `SELECT ea.id
           FROM "condominio-bh".tb_espaco_agenda ea
           JOIN "condominio-bh".tb_espaco e ON e.id = ea.id_espaco
          WHERE ea.id_condominio = :id_condominio
            AND ea.data_agendamento >= :data_agendamento_inicio
            AND ea.data_agendamento <  :data_agendamento_fim
            AND ea.status IN (1, 2, 3)
            AND e.sala_bloqueia_outras = 1
          LIMIT 1`,
        {
          replacements: {
            id_condominio: idCondominioToken,
            data_agendamento_inicio: inicioDiaUtc,
            data_agendamento_fim: fimDiaUtc
          },
          type: QueryTypes.SELECT
        }
      );
      if (bloqueadorJaReservado.length > 0) {
        return res.status(409).json({
          message: 'Existe uma sala exclusiva já reservada para esta data. Nenhuma outra sala pode ser reservada.'
        });
      }

      const reservasMesmoDia = await postgres.query(
        `SELECT id, status, periodo_manha, periodo_tarde, periodo_noite, modo_sala
           FROM "condominio-bh".tb_espaco_agenda
          WHERE id_condominio = :id_condominio
            AND id_espaco = :id_espaco
            AND data_agendamento >= :data_agendamento_inicio
            AND data_agendamento < :data_agendamento_fim
            AND status IN (1, 2, 3)`,
        {
          replacements: {
            id_condominio: idCondominioToken,
            id_espaco: idEspaco,
            data_agendamento_inicio: inicioDiaUtc,
            data_agendamento_fim: fimDiaUtc
          },
          type: QueryTypes.SELECT
        }
      );

      const periodoModoEspaco = String(espaco[0].periodo_modo || '').trim().toLowerCase();
      const modoSalaSolicitado = String(
        modo_sala || (periodo_manha && periodo_tarde && periodo_noite ? 'dia_inteiro' : 'blocos')
      )
        .trim()
        .toLowerCase();

      if (periodoModoEspaco === 'blocos') {
        const existeDiaInteiro = reservasMesmoDia.some(
          (item) => String(item.modo_sala || '').trim().toLowerCase() === 'dia_inteiro'
        );

        if (existeDiaInteiro) {
          return res.status(409).json({
            message: 'Existe agendamento em andamento para sala e não é possível.'
          });
        }

        if (modoSalaSolicitado === 'dia_inteiro' && reservasMesmoDia.length > 0) {
          return res.status(409).json({
            message: 'Existe agendamento em andamento para sala e não é possível.'
          });
        }

        const conflitoPorPeriodo = reservasMesmoDia.some((item) => {
          const itemModoSala = String(item.modo_sala || '').trim().toLowerCase();
          if (itemModoSala === 'dia_inteiro') {
            return true;
          }

          const itemManha = this._toInt(item.periodo_manha, 0) ? 1 : 0;
          const itemTarde = this._toInt(item.periodo_tarde, 0) ? 1 : 0;
          const itemNoite = this._toInt(item.periodo_noite, 0) ? 1 : 0;

          return (
            (periodo_manha === 1 && itemManha === 1) ||
            (periodo_tarde === 1 && itemTarde === 1) ||
            (periodo_noite === 1 && itemNoite === 1)
          );
        });

        if (conflitoPorPeriodo) {
          return res.status(409).json({
            message: 'Existe agendamento em andamento para sala e não é possível.'
          });
        }
      } else if (reservasMesmoDia.length > 0) {
        return res.status(409).json({
          message: 'Existe agendamento em andamento para sala e não é possível.'
        });
      }

      let agendaCriada = null;
      const transaction = await postgres.transaction();

      try {
        const insert = await postgres.query(
          `INSERT INTO "condominio-bh".tb_espaco_agenda (
             id_condominio,
             id_espaco,
             id_usuario,
             id_usuario_cadastro,
             taxa_reserva,
             status,
             observacoes,
             periodo_manha,
             periodo_tarde,
             periodo_noite,
             modo_sala,
             data_agendamento,
             created_at,
             updated_at
           ) VALUES (
             :id_condominio,
             :id_espaco,
             :id_usuario,
             :id_usuario_cadastro,
             :taxa_reserva,
             :status,
             :observacoes,
             :periodo_manha,
             :periodo_tarde,
             :periodo_noite,
             :modo_sala,
             :data_agendamento,
             now(),
             now()
           )
           RETURNING *`,
          {
            replacements: {
              id_condominio: idCondominioToken,
              id_espaco: idEspaco,
              id_usuario: idUsuarioReserva,
              id_usuario_cadastro: idUsuarioCadastro,
              taxa_reserva: taxaReservaAgenda,
              status,
              observacoes,
              periodo_manha,
              periodo_tarde,
              periodo_noite,
              modo_sala,
              data_agendamento
            },
            transaction
          }
        );

        agendaCriada = insert[0][0];

        const logMotivoPendente =
          req.body.motivo_pendencia !== undefined
            ? req.body.motivo_pendencia
            : req.body.tratamento_motivo_pendente;
        const logObservacao =
          req.body.tratamento_observacao !== undefined
            ? req.body.tratamento_observacao
            : req.body.observacoes;

        let logTaxaPaga = 0;
        if (req.body.taxa_paga_flag !== undefined && req.body.taxa_paga_flag !== null) {
          logTaxaPaga = this._toInt(req.body.taxa_paga_flag, 0) ? 1 : 0;
        } else if (req.body.taxa_paga !== undefined && req.body.taxa_paga !== null) {
          const taxaPagaRaw = String(req.body.taxa_paga).trim().toLowerCase();
          logTaxaPaga = ['1', 'true', 'sim', 'yes'].includes(taxaPagaRaw) ? 1 : 0;
        }

        await postgres.query(
          `INSERT INTO "condominio-bh".tb_log_tratamento_reserva (
             id_pedido,
             id_tratamento_status,
             tratamento_motivo_pendente,
             tratamento_taxa_paga,
             tratamento_observacao,
             id_usuario,
             created_at
           ) VALUES (
             :id_pedido,
             :id_tratamento_status,
             :tratamento_motivo_pendente,
             :tratamento_taxa_paga,
             :tratamento_observacao,
             :id_usuario,
             now()
           )`,
          {
            replacements: {
              id_pedido: agendaCriada.id,
              id_tratamento_status: status,
              tratamento_motivo_pendente:
                logMotivoPendente === undefined || logMotivoPendente === null
                  ? null
                  : String(logMotivoPendente).trim() || null,
              tratamento_taxa_paga: logTaxaPaga,
              tratamento_observacao:
                logObservacao === undefined || logObservacao === null
                  ? null
                  : String(logObservacao).trim() || null,
              id_usuario: idUsuarioToken
            },
            transaction
          }
        );

        const notificacaoTipoRows = await postgres.query(
          `SELECT id, titulo, descricao_padrao
             FROM "condominio-bh".tb_notificacao_tipo
            WHERE codigo = :codigo
              AND ativo = true
            LIMIT 1`,
          {
            replacements: {
              codigo: '2'
            },
            type: QueryTypes.SELECT,
            transaction
          }
        );

        if (notificacaoTipoRows && notificacaoTipoRows.length > 0) {
          const notificacaoTipo = notificacaoTipoRows[0];

          const usuariosDestino = await postgres.query(
            `SELECT tu.id
               FROM "condominio-bh"."tb-usuarios" tu
              WHERE tu.id_condominio = :id_condominio
                AND COALESCE(tu.tipo_perfil_id::text, '0') IN ('3', '4')
                AND COALESCE(tu.status, '') IN ('ativo', 'Ativo')`,
            {
              replacements: {
                id_condominio: idCondominioToken
              },
              type: QueryTypes.SELECT,
              transaction
            }
          );

          const mensagemNotificacao = [
            notificacaoTipo.titulo || 'Pedido Reserva',
            espaco[0]?.nome ? `- ${espaco[0].nome}` : null,
            dataAgendamentoIso ? `(${dataAgendamentoIso})` : null
          ]
            .filter((parte) => parte)
            .join(' ');

          for (const usuarioDestino of usuariosDestino) {
            const idUsuarioDestino = this._toInt(usuarioDestino.id, null);
            if (!idUsuarioDestino) {
              continue;
            }

            if (idUsuarioDestino === idUsuarioToken) {
              continue;
            }

            await postgres.query(
              `INSERT INTO "condominio-bh".tb_notificacao_log (
                  id_notificacao_tipo,
                  id_usuario,
                  mensagem,
                  id_usuario_pedido,
                  id_condominio,
                  id_codigo
                ) VALUES (
                  :id_notificacao_tipo,
                  :id_usuario,
                  :mensagem,
                  :id_usuario_pedido,
                  :id_condominio,
                  :id_codigo
                )`,
              {
                replacements: {
                  id_notificacao_tipo: this._toInt(notificacaoTipo.id, null),
                  id_usuario: idUsuarioDestino,
                  mensagem: mensagemNotificacao || notificacaoTipo.descricao_padrao || 'Pedido de reserva de espaço',
                  id_usuario_pedido: idUsuarioToken,
                  id_condominio: idCondominioToken,
                  id_codigo: this._toInt(agendaCriada.id, null)
                },
                type: QueryTypes.INSERT,
                transaction
              }
            );
          }
        }

        await transaction.commit();
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }

      // Disparo assíncrono de email — não bloqueia a resposta
      waitUntil((async () => {
        try {
          const [condominioRow] = await postgres.query(
            `SELECT nome FROM "condominio-bh"."tb-condominios" WHERE id = :id LIMIT 1`,
            { replacements: { id: idCondominioToken }, type: QueryTypes.SELECT }
          );

          const gestoresRows = await postgres.query(
            `SELECT email FROM "condominio-bh"."tb-usuarios"
              WHERE id_condominio = :id_condominio
                AND COALESCE(tipo_perfil_id::text, '0') IN ('3', '4')
                AND COALESCE(status, '') IN ('ativo', 'Ativo')
                AND email IS NOT NULL AND email <> ''`,
            { replacements: { id_condominio: idCondominioToken }, type: QueryTypes.SELECT }
          );

          const solicitante = usuarioReservaRows[0];
          const emailsGestores = [...new Set(gestoresRows.map((r) => r.email).filter(Boolean))];

          const periodos = [];
          if (periodo_manha) periodos.push('Manhã');
          if (periodo_tarde) periodos.push('Tarde');
          if (periodo_noite) periodos.push('Noite');
          const periodoTexto =
            modoSalaSolicitado === 'dia_inteiro' ? 'Dia Inteiro' : periodos.join(', ') || '-';

          const dataFormatada = dataAgendamentoIso
            ? dataAgendamentoIso.split('-').reverse().join('/')
            : '';

          await despacharEmailReserva({
            _id_agenda: agendaCriada.id,
            template: 'reserva_solicitacao',
            emails: emailsGestores,
            email_copia: solicitante?.email || null,
            solicitante: {
              nome: solicitante?.nome || '',
              email: solicitante?.email || '',
              apartamento: solicitante?.apartamento || '',
              bloco: solicitante?.bloco || ''
            },
            reserva: {
              id: String(agendaCriada.id),
              sala_nome: espaco[0]?.nome || '',
              data: dataFormatada,
              periodo: periodoTexto,
              observacao: observacoes || '',
              condominio_nome: condominioRow?.nome || ''
            }
          });
        } catch (emailErr) {
          console.error('[emailDispatch] Erro ao montar payload:', emailErr?.message);
        }
      })());

      return res.status(201).json({
        message: 'Sala agendada com sucesso.',
        data: agendaCriada
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao agendar sala.',
        detail: error.message
      });
    }
  }

  async atualizarTratamentoAgenda(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para atualizar tratamento da reserva.'
        });
      }

      const idAgenda = this._toInt(req.params.id ?? req.body.id, null);
      if (!idAgenda) {
        return res.status(400).json({ message: 'Id da agenda inválido.' });
      }

      let idStatus = null;
      const statusCode = this._toInt(req.body.status_code, null);
      const statusRaw =
        req.body.status === undefined || req.body.status === null
          ? null
          : String(req.body.status).trim();

      if (statusCode) {
        idStatus = statusCode;
      } else if (statusRaw) {
        const statusFromText = await postgres.query(
          `SELECT id
             FROM "condominio-bh".tb_status_tratamento
            WHERE lower(descricao_status) = lower(:descricao_status)
            LIMIT 1`,
          {
            replacements: { descricao_status: statusRaw },
            type: QueryTypes.SELECT
          }
        );

        if (!statusFromText || statusFromText.length === 0) {
          return res.status(400).json({
            message: 'Status informado não existe em tb_status_tratamento.'
          });
        }

        idStatus = this._toInt(statusFromText[0].id, null);
      }

      if (!idStatus) {
        return res.status(400).json({
          message: 'Informe status_code ou status para atualizar o tratamento.'
        });
      }

      if (![1, 2, 3, 4, 5].includes(idStatus)) {
        return res.status(400).json({
          success: false,
          message: 'Status inválido. Use 1 (em andamento), 2 (pendente), 3 (aprovado), 4 (recusado) ou 5 (cancelado).'
        });
      }

      const statusExists = await postgres.query(
        `SELECT id, descricao_status
           FROM "condominio-bh".tb_status_tratamento
          WHERE id = :id_status
          LIMIT 1`,
        {
          replacements: { id_status: idStatus },
          type: QueryTypes.SELECT
        }
      );

      if (!statusExists || statusExists.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Status inválido. Use 1 (em andamento), 2 (pendente), 3 (aprovado), 4 (recusado) ou 5 (cancelado).'
        });
      }

      const statusDescricao = String(statusExists[0].descricao_status || '');

      const observacaoInput =
        req.body.observacoes !== undefined ? req.body.observacoes : req.body.tratamento_observacao;
      const motivoInput =
        req.body.motivo_pendencia !== undefined
          ? req.body.motivo_pendencia
          : req.body.tratamento_motivo_pendente;

      const observacao =
        observacaoInput === undefined || observacaoInput === null
          ? null
          : String(observacaoInput).trim() || null;
      const motivoPendente =
        motivoInput === undefined || motivoInput === null ? null : String(motivoInput).trim() || null;

      let taxaPaga = null;
      if (req.body.taxa_paga_flag !== undefined && req.body.taxa_paga_flag !== null) {
        taxaPaga = this._toInt(req.body.taxa_paga_flag, 0) ? 1 : 0;
      } else if (req.body.taxa_paga !== undefined && req.body.taxa_paga !== null) {
        const taxaPagaRaw = String(req.body.taxa_paga).trim().toLowerCase();
        taxaPaga = ['1', 'true', 'sim', 'yes'].includes(taxaPagaRaw) ? 1 : 0;
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      const idUsuarioTratamento = this._toInt(
        req.body.id_usuario_tratamento !== undefined
          ? req.body.id_usuario_tratamento
          : idUsuarioToken,
        null
      );

      const avisarPortaria =
        req.body.avisar_portaria === true ||
        req.body.avisar_portaria === 'true' ||
        req.body.avisar_portaria === 1;
      const avisarColaborador =
        req.body.avisar_colaborador === true ||
        req.body.avisar_colaborador === 'true' ||
        req.body.avisar_colaborador === 1;

      const transaction = await postgres.transaction();
      let update = null;

      try {
        update = await postgres.query(
          `UPDATE "condominio-bh".tb_espaco_agenda
              SET status = :status,
                  tratamento_motivo_pendente = :tratamento_motivo_pendente,
                  tratamento_taxa_paga = COALESCE(:tratamento_taxa_paga, tratamento_taxa_paga),
                  tratamento_observacao = :tratamento_observacao,
                  id_usuario_tratamento = :id_usuario_tratamento,
                  data_tratamento = now(),
                  updated_at = now()
            WHERE id = :id
              AND id_condominio = :id_condominio
          RETURNING *`,
          {
            replacements: {
              id: idAgenda,
              id_condominio: idCondominioToken,
              status: idStatus,
              tratamento_motivo_pendente: motivoPendente,
              tratamento_taxa_paga: taxaPaga,
              tratamento_observacao: observacao,
              id_usuario_tratamento: idUsuarioTratamento
            },
            transaction
          }
        );

        if (!update[0] || update[0].length === 0) {
          await transaction.rollback();
          return res.status(404).json({
            message: 'Reserva de agenda não encontrada para este condomínio.'
          });
        }

        const updatedRow = update[0][0];

        await postgres.query(
          `INSERT INTO "condominio-bh".tb_log_tratamento_reserva (
             id_pedido,
             id_tratamento_status,
             tratamento_motivo_pendente,
             tratamento_taxa_paga,
             tratamento_observacao,
             id_usuario,
             created_at
           ) VALUES (
             :id_pedido,
             :id_tratamento_status,
             :tratamento_motivo_pendente,
             :tratamento_taxa_paga,
             :tratamento_observacao,
             :id_usuario,
             now()
           )`,
          {
            replacements: {
              id_pedido: idAgenda,
              id_tratamento_status: idStatus,
              tratamento_motivo_pendente: updatedRow.tratamento_motivo_pendente || null,
              tratamento_taxa_paga: this._toInt(updatedRow.tratamento_taxa_paga, 0),
              tratamento_observacao: updatedRow.tratamento_observacao || null,
              id_usuario: idUsuarioTratamento
            },
            transaction
          }
        );

        const statusNormalizado = this._normalizarPerfil(statusDescricao);
        const statusEhAprovacao = statusNormalizado.includes('aprov');
        const statusEhReprovacao =
          statusNormalizado.includes('reprov') ||
          statusNormalizado.includes('recus') ||
          statusNormalizado.includes('negad');
        const statusEhCancelamento = idStatus === 5 || statusNormalizado.includes('cancel');

        if (statusEhAprovacao || statusEhReprovacao || statusEhCancelamento) {
          const codigoPreferencial = statusEhAprovacao ? '1' : statusEhReprovacao ? '3' : '5';
          const termoBusca = statusEhAprovacao ? '%aprov%' : statusEhReprovacao ? '%reprov%' : '%cancel%';

          const notificacaoTipoRows = await postgres.query(
            `SELECT id, titulo, descricao_padrao
               FROM "condominio-bh".tb_notificacao_tipo
              WHERE ativo = true
                AND (
                  codigo = :codigo_preferencial
                  OR lower(COALESCE(titulo, '')) LIKE :termo_busca
                  OR lower(COALESCE(descricao_padrao, '')) LIKE :termo_busca
                )
              ORDER BY CASE WHEN codigo = :codigo_preferencial THEN 0 ELSE 1 END, id ASC
              LIMIT 1`,
            {
              replacements: {
                codigo_preferencial: codigoPreferencial,
                termo_busca: termoBusca
              },
              type: QueryTypes.SELECT,
              transaction
            }
          );

          const idUsuarioMorador = this._toInt(updatedRow.id_usuario, null);
          const notificacaoTipo = notificacaoTipoRows && notificacaoTipoRows.length > 0 ? notificacaoTipoRows[0] : null;

          if (idUsuarioMorador && notificacaoTipo) {
            const espacoReservaRows = await postgres.query(
              `SELECT nome
                 FROM "condominio-bh".tb_espaco
                WHERE id = :id_espaco
                LIMIT 1`,
              {
                replacements: {
                  id_espaco: this._toInt(updatedRow.id_espaco, null)
                },
                type: QueryTypes.SELECT,
                transaction
              }
            );

            const nomeEspacoReserva =
              espacoReservaRows && espacoReservaRows.length > 0
                ? String(espacoReservaRows[0].nome || '').trim() || null
                : null;
            const idReservaMensagem = this._toInt(updatedRow.id, null) || idAgenda;
            const mensagemBase = statusEhAprovacao
              ? `Reserva número ${idReservaMensagem} aprovada${nomeEspacoReserva ? ` para o espaço ${nomeEspacoReserva}` : ''}`
              : statusEhReprovacao
                ? `Reserva número ${idReservaMensagem} reprovada${nomeEspacoReserva ? ` para o espaço ${nomeEspacoReserva}` : ''}`
                : `Ocorreu cancelamento da reserva do espaço${nomeEspacoReserva ? ` ${nomeEspacoReserva}` : ''} (reserva número ${idReservaMensagem})`;

            const mensagemNotificacao = [
              mensagemBase,
              updatedRow.tratamento_observacao ? `- ${updatedRow.tratamento_observacao}` : null
            ]
              .filter((parte) => parte)
              .join(' ');

            await postgres.query(
              `INSERT INTO "condominio-bh".tb_notificacao_log (
                  id_notificacao_tipo,
                  id_usuario,
                  mensagem,
                  id_usuario_pedido,
                  id_condominio,
                  id_codigo
                ) VALUES (
                  :id_notificacao_tipo,
                  :id_usuario,
                  :mensagem,
                  :id_usuario_pedido,
                  :id_condominio,
                  :id_codigo
                )`,
              {
                replacements: {
                  id_notificacao_tipo: this._toInt(notificacaoTipo.id, null),
                  id_usuario: idUsuarioMorador,
                  mensagem: mensagemNotificacao || notificacaoTipo.descricao_padrao,
                  id_usuario_pedido: idUsuarioTratamento,
                  id_condominio: idCondominioToken,
                  id_codigo: idAgenda
                },
                type: QueryTypes.INSERT,
                transaction
              }
            );
          }
        }

        await transaction.commit();
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }

      // Email ao morador somente para aprovação (3), reprovação (4) ou cancelamento (5)
      if ([3, 4, 5].includes(idStatus)) {
        waitUntil((async () => {
          try {
            const [moradorReserva] = await postgres.query(
              `SELECT tu.nome, tu.email, tu.apartamento, tu.bloco,
                      te.nome AS espaco_nome,
                      tc.nome AS condominio_nome,
                      ea.data_agendamento, ea.tratamento_observacao
                 FROM "condominio-bh".tb_espaco_agenda ea
                 JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = ea.id_usuario
                 JOIN "condominio-bh".tb_espaco te ON te.id = ea.id_espaco
                 JOIN "condominio-bh"."tb-condominios" tc ON tc.id::text = ea.id_condominio::text
                WHERE ea.id = :id_agenda LIMIT 1`,
              { replacements: { id_agenda: idAgenda }, type: QueryTypes.SELECT }
            );
            if (!moradorReserva?.email) return;

            const statusTexto = idStatus === 3 ? 'Aprovada' : idStatus === 4 ? 'Reprovada' : 'Cancelada';
            const dataFormatada = moradorReserva.data_agendamento
              ? new Date(moradorReserva.data_agendamento).toISOString().slice(0, 10).split('-').reverse().join('/')
              : '';

            await despacharEmailReserva({
              _id_agenda: idAgenda,
              template: 'reserva_status',
              emails: [moradorReserva.email],
              solicitante: {
                nome: moradorReserva.nome || '',
                email: moradorReserva.email || '',
                apartamento: moradorReserva.apartamento || '',
                bloco: moradorReserva.bloco || ''
              },
              reserva: {
                sala_nome: moradorReserva.espaco_nome || '',
                data: dataFormatada,
                status: statusTexto,
                justificativa: moradorReserva.tratamento_observacao || observacao || '',
                condominio_nome: moradorReserva.condominio_nome || ''
              }
            });
          } catch (emailErr) {
            console.error('[emailDispatch] Erro status reserva:', emailErr?.message);
          }
        })());
      }

      // Aviso a Portaria/Colaborador — somente quando o tratamento é aprovação e ao menos uma flag veio true
      if (idStatus === 3 && (avisarPortaria || avisarColaborador)) {
        waitUntil((async () => {
          try {
            const perfisAvisar = [];
            if (avisarPortaria) perfisAvisar.push(5);
            if (avisarColaborador) perfisAvisar.push(54);

            const destinatarios = await postgres.query(
              `SELECT DISTINCT u.email
                 FROM "condominio-bh"."tb-usuarios" u
                WHERE u.id_condominio = :id_condominio
                  AND LOWER(COALESCE(u.status, '')) = 'ativo'
                  AND u.tipo_perfil_id IN (:perfis)
                  AND u.email IS NOT NULL AND u.email <> ''`,
              {
                replacements: { id_condominio: idCondominioToken, perfis: perfisAvisar },
                type: QueryTypes.SELECT
              }
            );

            const emails = destinatarios.map((d) => d.email).filter(Boolean);
            if (emails.length === 0) return;

            const [dadosReserva] = await postgres.query(
              `SELECT tu.nome, tu.email AS email_solicitante, tu.apartamento, tu.bloco,
                      te.nome AS espaco_nome,
                      tc.nome AS condominio_nome,
                      ea.data_agendamento, ea.tratamento_observacao
                 FROM "condominio-bh".tb_espaco_agenda ea
                 JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = ea.id_usuario
                 JOIN "condominio-bh".tb_espaco te ON te.id = ea.id_espaco
                 JOIN "condominio-bh"."tb-condominios" tc ON tc.id::text = ea.id_condominio::text
                WHERE ea.id = :id_agenda LIMIT 1`,
              { replacements: { id_agenda: idAgenda }, type: QueryTypes.SELECT }
            );
            if (!dadosReserva) return;

            const dataFormatada = dadosReserva.data_agendamento
              ? new Date(dadosReserva.data_agendamento).toISOString().slice(0, 10).split('-').reverse().join('/')
              : '';

            await despacharEmailReserva({
              _id_agenda: idAgenda,
              template: 'reserva_status',
              emails,
              solicitante: {
                nome: dadosReserva.nome || '',
                email: dadosReserva.email_solicitante || '',
                apartamento: dadosReserva.apartamento || '',
                bloco: dadosReserva.bloco || ''
              },
              reserva: {
                sala_nome: dadosReserva.espaco_nome || '',
                data: dataFormatada,
                status: 'Aprovada',
                justificativa: dadosReserva.tratamento_observacao || observacao || '',
                condominio_nome: dadosReserva.condominio_nome || ''
              }
            });
          } catch (emailErr) {
            console.error('[emailDispatch] Erro aviso Portaria/Colaborador:', emailErr?.message);
          }
        })());
      }

      const agendaAtualizada = await postgres.query(
        `SELECT
            ea.*,
            tt.descricao_status
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_status_tratamento tt
             ON tt.id = ea.status
          WHERE ea.id = :id
            AND ea.id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idAgenda,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      const logsTratamento = await this._buscarLogsTratamentoReserva(idAgenda);

      return res.status(200).json({
        message: 'Tratamento da reserva atualizado com sucesso.',
        data: agendaAtualizada[0] || update[0][0],
        logs: {
          total: logsTratamento.length,
          data: logsTratamento
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao atualizar tratamento da reserva.',
        detail: error.message
      });
    }
  }

  async listarLogsTratamentoAgenda(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar logs de tratamento.'
        });
      }

      const idAgenda = this._toInt(req.params.id, null);
      if (!idAgenda) {
        return res.status(400).json({ message: 'Id da agenda inválido.' });
      }

      const reserva = await postgres.query(
        `SELECT id
           FROM "condominio-bh".tb_espaco_agenda
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idAgenda,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!reserva || reserva.length === 0) {
        return res.status(404).json({
          message: 'Reserva de agenda não encontrada para este condomínio.'
        });
      }

      const logs = await this._buscarLogsTratamentoReserva(idAgenda);

      return res.status(200).json({
        total: logs.length,
        data: logs
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar logs de tratamento da reserva.',
        detail: error.message
      });
    }
  }

  async listarNotificacoesUsuario(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar notificações.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      if (!idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuário para listar notificações.'
        });
      }

      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      const idUsuario = this._toInt(req.params.id_usuario, null);
      if (!idUsuario) {
        return res.status(400).json({
          message: 'Parâmetro id_usuario inválido.'
        });
      }

      if (!ehAdmin && idUsuario !== idUsuarioToken) {
        return res.status(403).json({
          message: 'Não autorizado a listar notificações de outro usuário.'
        });
      }

      const data = await postgres.query(
        `SELECT
            nl.id,
            nl.id_notificacao_tipo,
            nt.codigo AS notificacao_codigo,
            nt.icone AS notificacao_icone,
            nt.cor AS notificacao_cor,
            nt.titulo AS notificacao_titulo,
            nt.descricao_padrao AS notificacao_descricao_padrao,
            nl.id_usuario,
            nl.id_usuario_pedido,
            solicitante.nome AS solicitante_nome,
            solicitante.sobrenome AS solicitante_sobrenome,
            nl.id_codigo,
            nl.mensagem,
            nl.lida_em,
            nl.created_at
          FROM "condominio-bh".tb_notificacao_log nl
          LEFT JOIN "condominio-bh".tb_notificacao_tipo nt
            ON nt.id = nl.id_notificacao_tipo
          LEFT JOIN "condominio-bh"."tb-usuarios" solicitante
            ON solicitante.id = nl.id_usuario_pedido
          WHERE nl.id_condominio = :id_condominio
            AND nl.id_usuario = :id_usuario
          ORDER BY
            CASE WHEN nl.lida_em IS NULL THEN 0 ELSE 1 END,
            nl.created_at DESC,
            nl.id DESC`,
        {
          replacements: {
            id_condominio: idCondominioToken,
            id_usuario: idUsuario
          },
          type: QueryTypes.SELECT
        }
      );

      const dataFormatada = data.map((item) => {
        const codigoNotificacao = String(item.notificacao_codigo || '').trim();
        const mensagemNormalizada = this._normalizarPerfil(item.mensagem || '');
        const ehNotificacaoTratamento =
          codigoNotificacao === '1' ||
          codigoNotificacao === '3' ||
          mensagemNormalizada.includes('aprovad') ||
          mensagemNormalizada.includes('reprov');

        if (!ehNotificacaoTratamento) {
          return item;
        }

        return {
          ...item,
          tratamento_nome: item.solicitante_nome || null,
          tratamento_sobrenome: item.solicitante_sobrenome || null,
          solicitante_nome: null,
          solicitante_sobrenome: null
        };
      });

      return res.status(200).json({
        total: dataFormatada.length,
        data: dataFormatada
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar notificações.',
        detail: error.message
      });
    }
  }

  async marcarNotificacaoComoLida(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para atualizar notificação.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      if (!idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuário para atualizar notificação.'
        });
      }

      const idPerfilToken = this._toInt(req.IdPerfil, null);
      const ehAdmin = idPerfilToken === 1;

      const idNotificacao = this._toInt(req.params.id, null);
      if (!idNotificacao) {
        return res.status(400).json({
          message: 'Parâmetro id inválido.'
        });
      }

      const notificacao = await postgres.query(
        `SELECT
            id,
            id_usuario,
            lida_em
          FROM "condominio-bh".tb_notificacao_log
          WHERE id = :id
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id: idNotificacao,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!notificacao || notificacao.length === 0) {
        return res.status(404).json({
          message: 'Notificação não encontrada para este condomínio.'
        });
      }

      const idUsuarioNotificacao = this._toInt(notificacao[0].id_usuario, null);
      if (!ehAdmin && idUsuarioNotificacao !== idUsuarioToken) {
        return res.status(403).json({
          message: 'Não autorizado a atualizar esta notificação.'
        });
      }

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_notificacao_log
            SET lida_em = COALESCE(lida_em, now())
          WHERE id = :id
            AND id_condominio = :id_condominio
          RETURNING
            id,
            id_notificacao_tipo,
            id_usuario,
            id_usuario_pedido,
            id_codigo,
            mensagem,
            lida_em,
            created_at`,
        {
          replacements: {
            id: idNotificacao,
            id_condominio: idCondominioToken
          }
        }
      );

      return res.status(200).json({
        message: 'Notificação atualizada com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao atualizar notificação.',
        detail: error.message
      });
    }
  }

  async listarRegulamentos(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar regulamentos.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['r.id_condominio = :id_condominio'];
      const replacements = {
        id_condominio: idCondominioToken
      };

      if (req.query.ativo !== undefined) {
        whereParts.push('r.ativo = :ativo');
        replacements.ativo = Boolean(req.query.ativo);
      }

      if (req.query.q !== undefined && String(req.query.q).trim() !== '') {
        whereParts.push(
          '(r.titulo ILIKE :q OR r.observacao ILIKE :q OR r.documento_salvo ILIKE :q OR r.tipo ILIKE :q OR r.descricao_regulamento ILIKE :q)'
        );
        replacements.q = `%${String(req.query.q).trim()}%`;
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_regulamento r
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            r.id,
            r.id_condominio,
            r.titulo,
            r.documento_salvo,
            r.tipo AS tipo_regulamento,
            r.descricao_regulamento,
            r.publicado_em,
            r.publicado_por,
            tu.nome AS nome,
            tu.tipo AS tipo,
            r.ativo,
            r.observacao
          FROM "condominio-bh".tb_regulamento r
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = r.publicado_por
            AND tu.id_condominio = r.id_condominio
          WHERE ${whereClause}
          ORDER BY r.ativo DESC, r.publicado_em DESC, r.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...replacements,
            limit: pageSize,
            offset
          },
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar regulamentos.',
        detail: error.message
      });
    }
  }

  async buscarRegulamentoAtivo(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar regulamento ativo.'
        });
      }

      const rows = await postgres.query(
        `SELECT
            r.id,
            r.id_condominio,
            r.titulo,
            r.documento_salvo,
            r.tipo AS tipo_regulamento,
            r.descricao_regulamento,
            r.publicado_em,
            r.publicado_por,
            tu.nome AS nome,
            tu.tipo AS tipo,
            r.ativo,
            r.observacao
           FROM "condominio-bh".tb_regulamento r
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = r.publicado_por
            AND tu.id_condominio = r.id_condominio
          WHERE r.id_condominio = :id_condominio
            AND r.ativo = true
          ORDER BY r.publicado_em DESC, r.id DESC
          LIMIT 1`,
        {
          replacements: { id_condominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          message: 'Regulamento ativo não encontrado para este condomínio.'
        });
      }

      return res.status(200).json({
        data: rows[0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar regulamento ativo.',
        detail: error.message
      });
    }
  }

  async buscarRegulamentoPorId(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar regulamento.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do regulamento inválido.' });
      }

      const rows = await postgres.query(
        `SELECT
            r.id,
            r.id_condominio,
            r.titulo,
            r.documento_salvo,
            r.tipo AS tipo_regulamento,
            r.descricao_regulamento,
            r.publicado_em,
            r.publicado_por,
            tu.nome AS nome,
            tu.tipo AS tipo,
            r.ativo,
            r.observacao
           FROM "condominio-bh".tb_regulamento r
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = r.publicado_por
            AND tu.id_condominio = r.id_condominio
          WHERE r.id = :id
            AND r.id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          message: 'Regulamento não encontrado para este condomínio.'
        });
      }

      return res.status(200).json({
        data: rows[0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar regulamento.',
        detail: error.message
      });
    }
  }

  async registrarAceiteRegulamentoAtivo(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para registrar aceite do regulamento.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      if (!idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuario para registrar aceite do regulamento.'
        });
      }

      const idRegulamentoBody = this._toInt(req.body.id_regulamento, null);

      const regulamentoAtivoRows = await postgres.query(
        `SELECT id, id_condominio, titulo, ativo, publicado_em
           FROM "condominio-bh".tb_regulamento
          WHERE id_condominio = :id_condominio
            AND ativo = true
          ORDER BY publicado_em DESC, id DESC
          LIMIT 1`,
        {
          replacements: { id_condominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      if (!regulamentoAtivoRows || regulamentoAtivoRows.length === 0) {
        return res.status(404).json({
          message: 'Regulamento ativo nao encontrado para este condominio.'
        });
      }

      const regulamentoAtivo = regulamentoAtivoRows[0];

      if (idRegulamentoBody && idRegulamentoBody !== this._toInt(regulamentoAtivo.id, null)) {
        return res.status(409).json({
          message: 'Somente o regulamento ativo pode receber aceite.'
        });
      }

      const usuarioRows = await postgres.query(
        `SELECT id
           FROM "condominio-bh"."tb-usuarios"
          WHERE id = :id_usuario
            AND id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id_usuario: idUsuarioToken,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!usuarioRows || usuarioRows.length === 0) {
        return res.status(403).json({
          message: 'Usuario nao pertence ao condominio informado no token.'
        });
      }

      const existenteRows = await postgres.query(
        `SELECT id, id_regulamento, id_usuario, aceito_em, ip
           FROM "condominio-bh".tb_regulamento_aceite
          WHERE id_regulamento = :id_regulamento
            AND id_usuario = :id_usuario
          LIMIT 1`,
        {
          replacements: {
            id_regulamento: regulamentoAtivo.id,
            id_usuario: idUsuarioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (existenteRows && existenteRows.length > 0) {
        return res.status(200).json({
          message: 'Aceite ja registrado para o regulamento ativo.',
          data: existenteRows[0]
        });
      }

      const ip = this._resolveRequestIp(req);

      const insert = await postgres.query(
        `INSERT INTO "condominio-bh".tb_regulamento_aceite (
            id_regulamento,
            id_usuario,
            aceito_em,
            ip
        ) VALUES (
            :id_regulamento,
            :id_usuario,
            now(),
            :ip
        )
        RETURNING id, id_regulamento, id_usuario, aceito_em, ip`,
        {
          replacements: {
            id_regulamento: regulamentoAtivo.id,
            id_usuario: idUsuarioToken,
            ip
          }
        }
      );

      return res.status(201).json({
        message: 'Aceite do regulamento registrado com sucesso.',
        data: insert[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao registrar aceite do regulamento.',
        detail: error.message
      });
    }
  }

  async buscarAceiteRegulamentoAtivo(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar aceite do regulamento ativo.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      if (!idUsuarioToken) {
        return res.status(403).json({
          message: 'Token sem id de usuario para buscar aceite do regulamento ativo.'
        });
      }

      const regulamentoAtivoRows = await postgres.query(
        `SELECT
            r.id,
            r.id_condominio,
            r.titulo,
            r.documento_salvo,
            r.tipo AS tipo_regulamento,
            r.descricao_regulamento,
            r.publicado_em,
            r.publicado_por,
            tu.nome AS nome,
            tu.tipo AS tipo,
            r.ativo,
            r.observacao
           FROM "condominio-bh".tb_regulamento r
          LEFT JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = r.publicado_por
            AND tu.id_condominio = r.id_condominio
          WHERE r.id_condominio = :id_condominio
            AND r.ativo = true
          ORDER BY r.publicado_em DESC, r.id DESC
          LIMIT 1`,
        {
          replacements: { id_condominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      if (!regulamentoAtivoRows || regulamentoAtivoRows.length === 0) {
        return res.status(404).json({
          message: 'Regulamento ativo nao encontrado para este condominio.'
        });
      }

      const regulamentoAtivo = regulamentoAtivoRows[0];

      const aceiteRows = await postgres.query(
        `SELECT id, id_regulamento, id_usuario, aceito_em, ip
           FROM "condominio-bh".tb_regulamento_aceite
          WHERE id_regulamento = :id_regulamento
            AND id_usuario = :id_usuario
          ORDER BY aceito_em DESC, id DESC
          LIMIT 1`,
        {
          replacements: {
            id_regulamento: regulamentoAtivo.id,
            id_usuario: idUsuarioToken
          },
          type: QueryTypes.SELECT
        }
      );

      const moradorDeuAceite = Boolean(aceiteRows && aceiteRows.length > 0);

      return res.status(200).json({
        morador_deu_aceite: moradorDeuAceite,
        data: {
          regulamento: regulamentoAtivo,
          aceitou: moradorDeuAceite,
          morador_deu_aceite: moradorDeuAceite,
          aceite: aceiteRows && aceiteRows.length > 0 ? aceiteRows[0] : null
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar aceite do regulamento ativo.',
        detail: error.message
      });
    }
  }

  async listarAceitesRegulamento(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar aceites do regulamento.'
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['r.id_condominio = :id_condominio'];
      const replacements = {
        id_condominio: idCondominioToken
      };

      const idRegulamento = this._toInt(req.query.id_regulamento, null);
      if (idRegulamento) {
        whereParts.push('a.id_regulamento = :id_regulamento');
        replacements.id_regulamento = idRegulamento;
      }

      const idUsuario = this._toInt(req.query.id_usuario, null);
      if (idUsuario) {
        whereParts.push('a.id_usuario = :id_usuario');
        replacements.id_usuario = idUsuario;
      }

      if (req.query.ativo !== undefined) {
        whereParts.push('r.ativo = :ativo');
        replacements.ativo = Boolean(req.query.ativo);
      }

      const whereClause = whereParts.join(' AND ');

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh".tb_regulamento_aceite a
           INNER JOIN "condominio-bh".tb_regulamento r
              ON r.id = a.id_regulamento
          WHERE ${whereClause}`,
        {
          replacements,
          type: QueryTypes.SELECT
        }
      );

      const data = await postgres.query(
        `SELECT
            a.id,
            a.id_regulamento,
            a.id_usuario,
            a.aceito_em,
            a.ip,
            r.titulo AS regulamento_titulo,
            r.ativo AS regulamento_ativo,
            u.nome AS usuario_nome,
            u.tipo AS usuario_tipo
           FROM "condominio-bh".tb_regulamento_aceite a
           INNER JOIN "condominio-bh".tb_regulamento r
              ON r.id = a.id_regulamento
           LEFT JOIN "condominio-bh"."tb-usuarios" u
              ON u.id = a.id_usuario
             AND u.id_condominio = r.id_condominio
          WHERE ${whereClause}
          ORDER BY a.aceito_em DESC, a.id DESC
          LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...replacements,
            limit: pageSize,
            offset
          },
          type: QueryTypes.SELECT
        }
      );

      const total = totalRows[0]?.total || 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao listar aceites do regulamento.',
        detail: error.message
      });
    }
  }

  async buscarAceiteRegulamentoPorId(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para buscar aceite do regulamento.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do aceite invalido.' });
      }

      const rows = await postgres.query(
        `SELECT
            a.id,
            a.id_regulamento,
            a.id_usuario,
            a.aceito_em,
            a.ip,
            r.id_condominio,
            r.titulo AS regulamento_titulo,
            r.ativo AS regulamento_ativo,
            u.nome AS usuario_nome,
            u.tipo AS usuario_tipo
           FROM "condominio-bh".tb_regulamento_aceite a
           INNER JOIN "condominio-bh".tb_regulamento r
              ON r.id = a.id_regulamento
           LEFT JOIN "condominio-bh"."tb-usuarios" u
              ON u.id = a.id_usuario
             AND u.id_condominio = r.id_condominio
          WHERE a.id = :id
            AND r.id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          message: 'Aceite do regulamento nao encontrado para este condominio.'
        });
      }

      return res.status(200).json({
        data: rows[0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar aceite do regulamento.',
        detail: error.message
      });
    }
  }

  async editarAceiteRegulamento(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para editar aceite do regulamento.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do aceite invalido.' });
      }

      const atualRows = await postgres.query(
        `SELECT a.id, a.id_regulamento, a.id_usuario, a.aceito_em, a.ip
           FROM "condominio-bh".tb_regulamento_aceite a
           INNER JOIN "condominio-bh".tb_regulamento r
              ON r.id = a.id_regulamento
          WHERE a.id = :id
            AND r.id_condominio = :id_condominio
          LIMIT 1`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          },
          type: QueryTypes.SELECT
        }
      );

      if (!atualRows || atualRows.length === 0) {
        return res.status(404).json({
          message: 'Aceite do regulamento nao encontrado para este condominio.'
        });
      }

      const atual = atualRows[0];

      let idRegulamento = this._toInt(atual.id_regulamento, null);
      if (req.body.id_regulamento !== undefined) {
        idRegulamento = this._toInt(req.body.id_regulamento, null);
        if (!idRegulamento) {
          return res.status(400).json({ message: 'Campo id_regulamento invalido.' });
        }

        const regulamentoRows = await postgres.query(
          `SELECT id
             FROM "condominio-bh".tb_regulamento
            WHERE id = :id
              AND id_condominio = :id_condominio
            LIMIT 1`,
          {
            replacements: {
              id: idRegulamento,
              id_condominio: idCondominioToken
            },
            type: QueryTypes.SELECT
          }
        );

        if (!regulamentoRows || regulamentoRows.length === 0) {
          return res.status(404).json({
            message: 'Regulamento informado nao encontrado para este condominio.'
          });
        }
      }

      let idUsuario = this._toInt(atual.id_usuario, null);
      if (req.body.id_usuario !== undefined) {
        idUsuario = this._toInt(req.body.id_usuario, null);
        if (!idUsuario) {
          return res.status(400).json({ message: 'Campo id_usuario invalido.' });
        }

        const usuarioRows = await postgres.query(
          `SELECT id
             FROM "condominio-bh"."tb-usuarios"
            WHERE id = :id_usuario
              AND id_condominio = :id_condominio
            LIMIT 1`,
          {
            replacements: {
              id_usuario: idUsuario,
              id_condominio: idCondominioToken
            },
            type: QueryTypes.SELECT
          }
        );

        if (!usuarioRows || usuarioRows.length === 0) {
          return res.status(404).json({
            message: 'Usuario informado nao encontrado para este condominio.'
          });
        }
      }

      const conflitoRows = await postgres.query(
        `SELECT id
           FROM "condominio-bh".tb_regulamento_aceite
          WHERE id <> :id
            AND id_regulamento = :id_regulamento
            AND id_usuario = :id_usuario
          LIMIT 1`,
        {
          replacements: {
            id,
            id_regulamento: idRegulamento,
            id_usuario: idUsuario
          },
          type: QueryTypes.SELECT
        }
      );

      if (conflitoRows && conflitoRows.length > 0) {
        return res.status(409).json({
          message: 'Ja existe aceite para este usuario e regulamento.'
        });
      }

      const aceitoEmInput = req.body.aceito_em;
      const aceitoEm =
        aceitoEmInput !== undefined && aceitoEmInput !== null && String(aceitoEmInput).trim() !== ''
          ? new Date(aceitoEmInput)
          : new Date(atual.aceito_em);

      if (Number.isNaN(aceitoEm.getTime())) {
        return res.status(400).json({ message: 'Campo aceito_em invalido.' });
      }

      const ip =
        req.body.ip !== undefined
          ? req.body.ip === null || String(req.body.ip).trim() === ''
            ? null
            : String(req.body.ip).trim()
          : atual.ip;

      const update = await postgres.query(
        `UPDATE "condominio-bh".tb_regulamento_aceite
            SET id_regulamento = :id_regulamento,
                id_usuario = :id_usuario,
                aceito_em = :aceito_em,
                ip = :ip
          WHERE id = :id
        RETURNING id, id_regulamento, id_usuario, aceito_em, ip`,
        {
          replacements: {
            id,
            id_regulamento: idRegulamento,
            id_usuario: idUsuario,
            aceito_em: aceitoEm,
            ip
          }
        }
      );

      return res.status(200).json({
        message: 'Aceite do regulamento atualizado com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao editar aceite do regulamento.',
        detail: error.message
      });
    }
  }

  async excluirAceiteRegulamento(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para excluir aceite do regulamento.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do aceite invalido.' });
      }

      const remove = await postgres.query(
        `DELETE FROM "condominio-bh".tb_regulamento_aceite a
          USING "condominio-bh".tb_regulamento r
          WHERE a.id = :id
            AND r.id = a.id_regulamento
            AND r.id_condominio = :id_condominio
        RETURNING a.id, a.id_regulamento, a.id_usuario, a.aceito_em, a.ip`,
        {
          replacements: {
            id,
            id_condominio: idCondominioToken
          }
        }
      );

      if (!remove[0] || remove[0].length === 0) {
        return res.status(404).json({
          message: 'Aceite do regulamento nao encontrado para este condominio.'
        });
      }

      return res.status(200).json({
        message: 'Aceite do regulamento excluido com sucesso.',
        data: remove[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao excluir aceite do regulamento.',
        detail: error.message
      });
    }
  }

  async criarRegulamento(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para criar regulamento.'
        });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      const titulo = String(req.body.titulo || '').trim();
      const documentoSalvo =
        req.body.documento_salvo !== undefined
          ? req.body.documento_salvo
            ? String(req.body.documento_salvo).trim()
            : null
          : null;
      const observacao =
        req.body.observacao !== undefined ? (req.body.observacao ? String(req.body.observacao).trim() : null) : null;
      const tipoInput = req.body.tipo !== undefined ? req.body.tipo : req.body.tipo_regulamento;
      const tipo = tipoInput !== undefined ? (tipoInput ? String(tipoInput).trim() : null) : null;
      const descricaoRegulamento =
        req.body.descricao_regulamento !== undefined
          ? req.body.descricao_regulamento
            ? String(req.body.descricao_regulamento).trim()
            : null
          : null;
      const ativo = req.body.ativo === undefined ? true : Boolean(req.body.ativo);

      let inserted;

      await postgres.transaction(async (transaction) => {
        if (ativo) {
          await postgres.query(
            `UPDATE "condominio-bh".tb_regulamento
                SET ativo = false
              WHERE id_condominio = :id_condominio
                AND ativo = true`,
            {
              replacements: {
                id_condominio: idCondominioToken
              },
              transaction
            }
          );
        }

        const insert = await postgres.query(
          `INSERT INTO "condominio-bh".tb_regulamento (
              id_condominio,
              titulo,
              documento_salvo,
              publicado_em,
              publicado_por,
              ativo,
              observacao,
              tipo,
              descricao_regulamento
          ) VALUES (
              :id_condominio,
              :titulo,
              :documento_salvo,
              now(),
              :publicado_por,
              :ativo,
              :observacao,
              :tipo,
              :descricao_regulamento
          )
          RETURNING *`,
          {
            replacements: {
              id_condominio: idCondominioToken,
              titulo,
              documento_salvo: documentoSalvo,
              publicado_por: idUsuarioToken,
              ativo,
              observacao,
              tipo,
              descricao_regulamento: descricaoRegulamento
            },
            transaction
          }
        );

        inserted = insert[0][0];
      });

      return res.status(201).json({
        message: 'Regulamento criado com sucesso.',
        data: inserted
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao criar regulamento.',
        detail: error.message
      });
    }
  }

  async editarRegulamento(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para editar regulamento.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do regulamento inválido.' });
      }

      const idUsuarioToken = this._toInt(req.idcliente, null);
      let updated;

      await postgres.transaction(async (transaction) => {
        const atualRows = await postgres.query(
          `SELECT *
             FROM "condominio-bh".tb_regulamento
            WHERE id = :id
              AND id_condominio = :id_condominio
            LIMIT 1`,
          {
            replacements: {
              id,
              id_condominio: idCondominioToken
            },
            type: QueryTypes.SELECT,
            transaction
          }
        );

        if (!atualRows || atualRows.length === 0) {
          throw new Error('NOT_FOUND');
        }

        const atual = atualRows[0];

        const titulo = req.body.titulo !== undefined ? String(req.body.titulo || '').trim() : atual.titulo;
        const documentoSalvo =
          req.body.documento_salvo !== undefined
            ? req.body.documento_salvo
              ? String(req.body.documento_salvo).trim()
              : null
            : atual.documento_salvo;
        const ativo = req.body.ativo !== undefined ? Boolean(req.body.ativo) : Boolean(atual.ativo);
        const observacao =
          req.body.observacao !== undefined
            ? req.body.observacao
              ? String(req.body.observacao).trim()
              : null
            : atual.observacao;
        const tipoInput = req.body.tipo !== undefined ? req.body.tipo : req.body.tipo_regulamento;
        const tipo = tipoInput !== undefined ? (tipoInput ? String(tipoInput).trim() : null) : atual.tipo;
        const descricaoRegulamento =
          req.body.descricao_regulamento !== undefined
            ? req.body.descricao_regulamento
              ? String(req.body.descricao_regulamento).trim()
              : null
            : atual.descricao_regulamento;

        if (ativo) {
          await postgres.query(
            `UPDATE "condominio-bh".tb_regulamento
                SET ativo = false
              WHERE id_condominio = :id_condominio
                AND id <> :id
                AND ativo = true`,
            {
              replacements: {
                id_condominio: idCondominioToken,
                id
              },
              transaction
            }
          );
        }

        const update = await postgres.query(
          `UPDATE "condominio-bh".tb_regulamento
              SET titulo = :titulo,
                documento_salvo = :documento_salvo,
                  publicado_por = :publicado_por,
                  ativo = :ativo,
                  observacao = :observacao,
                  tipo = :tipo,
                  descricao_regulamento = :descricao_regulamento
            WHERE id = :id
              AND id_condominio = :id_condominio
          RETURNING *`,
          {
            replacements: {
              id,
              id_condominio: idCondominioToken,
              titulo,
              documento_salvo: documentoSalvo,
              publicado_por: idUsuarioToken || atual.publicado_por,
              ativo,
              observacao,
              tipo,
              descricao_regulamento: descricaoRegulamento
            },
            transaction
          }
        );

        updated = update[0][0];
      });

      return res.status(200).json({
        message: 'Regulamento atualizado com sucesso.',
        data: updated
      });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return res.status(404).json({
          message: 'Regulamento não encontrado para este condomínio.'
        });
      }

      return res.status(500).json({
        message: 'Falha ao editar regulamento.',
        detail: error.message
      });
    }
  }

  async excluirRegulamento(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para excluir regulamento.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do regulamento inválido.' });
      }

      let deleted;

      await postgres.transaction(async (transaction) => {
        const remove = await postgres.query(
          `DELETE FROM "condominio-bh".tb_regulamento
            WHERE id = :id
              AND id_condominio = :id_condominio
          RETURNING *`,
          {
            replacements: {
              id,
              id_condominio: idCondominioToken
            },
            transaction
          }
        );

        if (!remove[0] || remove[0].length === 0) {
          throw new Error('NOT_FOUND');
        }

        deleted = remove[0][0];

        if (deleted.ativo) {
          const regulamentoMaisRecente = await postgres.query(
            `SELECT id
               FROM "condominio-bh".tb_regulamento
              WHERE id_condominio = :id_condominio
              ORDER BY publicado_em DESC, id DESC
              LIMIT 1`,
            {
              replacements: {
                id_condominio: idCondominioToken
              },
              type: QueryTypes.SELECT,
              transaction
            }
          );

          if (regulamentoMaisRecente && regulamentoMaisRecente.length > 0) {
            await postgres.query(
              `UPDATE "condominio-bh".tb_regulamento
                  SET ativo = true
                WHERE id = :id`,
              {
                replacements: {
                  id: regulamentoMaisRecente[0].id
                },
                transaction
              }
            );
          }
        }
      });

      return res.status(200).json({
        message: 'Regulamento excluído com sucesso.',
        data: deleted
      });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return res.status(404).json({
          message: 'Regulamento não encontrado para este condomínio.'
        });
      }

      return res.status(500).json({
        message: 'Falha ao excluir regulamento.',
        detail: error.message
      });
    }
  }

  async excluirEspaco(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para excluir espaço.'
        });
      }

      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id inválido.' });
      }

      const deleted = await postgres.query(
        `DELETE FROM "condominio-bh".tb_espaco
          WHERE id = :id
            AND id_condominio = :id_condominio
        RETURNING *`,
        {
          replacements: { id, id_condominio: idCondominioToken }
        }
      );

      if (!deleted[0] || deleted[0].length === 0) {
        return res.status(404).json({ message: 'Espaço não encontrado.' });
      }

      return res.status(200).json({
        message: 'Espaço excluído com sucesso.',
        data: deleted[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao excluir espaço.',
        detail: error.message
      });
    }
  }
}

module.exports = CondominioController;