"use strict";

const { QueryTypes } = require("sequelize");
const postgres = require("../database/postgres");
const pushNotificationService = require("../service/pushNotificationService");
const { despacharEmail } = require("../service/emailDispatchService");
const { waitUntil } = require("@vercel/functions");

const TIPOS_REUNIAO = new Set(["ordinaria", "extraordinaria"]);
const STATUS_REUNIAO = new Set(["CRIADA", "CONVOCADA", "EM_ANDAMENTO", "FINALIZADA", "CANCELADA"]);
const FILTROS_DESTINATARIO = new Set(["todos", "inquilinos", "proprietarios"]);
const TIPO_MORADOR_POR_FILTRO = { inquilinos: "inquilino", proprietarios: "proprietario" };
const STATUS_REUNIAO_ABERTA = ["CRIADA", "CONVOCADA", "EM_ANDAMENTO"];
class ReuniaoController {
  _toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  _normalizarTextoOuNull(value, maxLength = null) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (text === "") return null;
    if (maxLength && Number.isInteger(maxLength) && maxLength > 0) return text.slice(0, maxLength);
    return text;
  }

  _parseDataHora(value) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const raw = String(value).trim();
    if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
      const [datePart, timePart] = raw.split(" ");
      const [dia, mes, ano] = datePart.split("/").map(Number);
      const [hora = 0, min = 0] = (timePart || "").split(":").map(Number);
      const dt = new Date(Date.UTC(ano, mes - 1, dia, hora, min, 0));
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  _normalizarItensPauta(value) {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr
      .map((item, i) => {
        if (item && typeof item === "object") {
          return {
            titulo: this._normalizarTextoOuNull(item.titulo, 200),
            descricao: this._normalizarTextoOuNull(item.descricao),
            ordem: this._toInt(item.ordem, i + 1)
          };
        }
        const t = this._normalizarTextoOuNull(String(item), 200);
        return t ? { titulo: t, descricao: null, ordem: i + 1 } : null;
      })
      .filter(Boolean);
  }

  async _inserirPautas(idReuniao, itens) {
    if (!idReuniao || !itens || itens.length === 0) return;
    for (const item of itens) {
      await postgres.query(
        `INSERT INTO "condominio-bh".tb_reuniao_pauta (id_reuniao, titulo, descricao, ordem)
          VALUES (:id_reuniao, :titulo, :descricao, :ordem)`,
        {
          replacements: {
            id_reuniao: idReuniao,
            titulo: item.titulo,
            descricao: item.descricao,
            ordem: item.ordem
          },
          type: QueryTypes.INSERT
        }
      );
    }
  }

  _buildPaginacao(query) {
    const page = this._toInt(query.page, null);
    const pageSize = this._toInt(query.pageSize ?? query.page_size, 20);
    if (!page) return { limit: null, offset: null, page: null, pageSize: null };
    const safePage = Math.max(page, 1);
    const safeSize = Math.min(Math.max(pageSize, 1), 100);
    return { limit: safeSize, offset: (safePage - 1) * safeSize, page: safePage, pageSize: safeSize };
  }

  async listar(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const { query } = req;
      const status = this._normalizarTextoOuNull(query.status);
      const tipo = this._normalizarTextoOuNull(query.tipo);
      const dataInicio = this._parseDataHora(query.data_inicio);
      const dataFim = this._parseDataHora(query.data_fim);
      const { limit, offset, page, pageSize } = this._buildPaginacao(query);

      const whereParts = ["r.id_condominio = :id_condominio"];
      const replacements = { id_condominio: idCondominio };

      if (status) { whereParts.push("r.status = :status"); replacements.status = status.toUpperCase(); }
      if (tipo) { whereParts.push("LOWER(r.tipo) = LOWER(:tipo)"); replacements.tipo = tipo.toLowerCase(); }
      if (dataInicio) { whereParts.push("r.data_hora >= :data_inicio"); replacements.data_inicio = dataInicio; }
      if (dataFim) { whereParts.push("r.data_hora <= :data_fim"); replacements.data_fim = dataFim; }

      const whereClause = whereParts.join(" AND ");

      const [rows, contagem] = await Promise.all([
        postgres.query(
          `SELECT r.id, r.titulo, r.descricao, r.tipo, r.data_hora, r.local, r.link_online,
                  r.pauta, r.status, r.participantes, r.id_usuario_criador, tu.nome AS nome_criador,
                  r.created_at, r.updated_at
             FROM "condominio-bh".tb_reuniao r
             LEFT JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = r.id_usuario_criador
            WHERE ${whereClause}
            ORDER BY r.data_hora DESC
            ${limit ? "LIMIT :limit OFFSET :offset" : ""}`,
          { replacements: { ...replacements, ...(limit ? { limit, offset } : {}) }, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COUNT(*) AS total FROM "condominio-bh".tb_reuniao r WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        )
      ]);

      const totalCount = this._toInt(contagem[0]?.total, 0);
      const response = { data: rows, total: totalCount };
      if (page) { response.page = page; response.pageSize = pageSize; response.totalPages = Math.ceil(totalCount / pageSize); }
      return res.status(200).json(response);
    } catch (error) {
      return res.status(500).json({ message: "Erro ao listar reunioes.", detail: error.message });
    }
  }

  async buscarPorId(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const id = this._toInt(req.params.id, null);
      if (!id) return res.status(400).json({ message: "Parametro id invalido." });

      const [reuniao] = await postgres.query(
        `SELECT r.id, r.titulo, r.descricao, r.tipo, r.data_hora, r.local, r.link_online,
                r.ata, r.status, r.participantes, r.id_usuario_criador,
                tu.nome AS nome_criador, r.created_at, r.updated_at
           FROM "condominio-bh".tb_reuniao r
           LEFT JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = r.id_usuario_criador
          WHERE r.id = :id AND r.id_condominio = :id_condominio LIMIT 1`,
        { replacements: { id, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      if (!reuniao) return res.status(404).json({ message: "Reuniao nao encontrada." });

      const [pautaItens, presencas] = await Promise.all([
        postgres.query(
          `SELECT id, titulo, descricao, ordem
             FROM "condominio-bh".tb_reuniao_pauta
            WHERE id_reuniao = :id_reuniao
            ORDER BY COALESCE(ordem, id)`,
          { replacements: { id_reuniao: id }, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT rp.id, rp.id_usuario, tu.nome, tu.apartamento, tu.bloco,
                  rp.presente, rp.data_checkin
             FROM "condominio-bh".tb_reuniao_presenca rp
             JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = rp.id_usuario
            WHERE rp.id_reuniao = :id_reuniao ORDER BY tu.nome`,
          { replacements: { id_reuniao: id }, type: QueryTypes.SELECT }
        )
      ]);

      return res.status(200).json({ ...reuniao, pauta: pautaItens, presencas });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao buscar reuniao.", detail: error.message });
    }
  }

  async criar(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const idUsuarioCriador = this._toInt(req.idcliente, null);
      const { body } = req;
      const titulo = this._normalizarTextoOuNull(body.titulo, 255);
      const descricao = this._normalizarTextoOuNull(body.descricao);
      const tipo = (this._normalizarTextoOuNull(body.tipo, 50) || "ordinaria").toLowerCase();
      const dataHora = this._parseDataHora(body.data_hora);
      const local = this._normalizarTextoOuNull(body.local, 255);
      const linkOnline = this._normalizarTextoOuNull(body.link_online, 500);
      const itensPauta = this._normalizarItensPauta(body.pauta);
      const dataLimiteConfirmacao = this._parseDataHora(body.data_limite_confirmacao);
      const notificarMoradores = body.notificar_moradores !== false;
      const enviarEmail = body.enviar_email === 1 || body.enviar_email === "1" || body.enviar_email === true;
      const filtroDestinatarioRaw = (this._normalizarTextoOuNull(body.filtro_destinatario, 20) || "todos").toLowerCase();
      if (!FILTROS_DESTINATARIO.has(filtroDestinatarioRaw)) {
        return res.status(400).json({ message: `filtro_destinatario invalido. Use: ${[...FILTROS_DESTINATARIO].join(", ")}.` });
      }
      const tipoMoradorFiltro = TIPO_MORADOR_POR_FILTRO[filtroDestinatarioRaw] || null;

      if (!titulo) return res.status(400).json({ message: "Campo titulo e obrigatorio." });
      if (!dataHora) return res.status(400).json({ message: "Campo data_hora invalido ou ausente." });
      if (!TIPOS_REUNIAO.has(tipo)) return res.status(400).json({ message: `Tipo invalido. Use: ${[...TIPOS_REUNIAO].join(", ")}.` });

      const [reuniaoAberta] = await postgres.query(
        `SELECT id, titulo, status FROM "condominio-bh".tb_reuniao
          WHERE id_condominio = :id_condominio AND status IN (:status_abertos)
          ORDER BY data_hora DESC LIMIT 1`,
        { replacements: { id_condominio: idCondominio, status_abertos: STATUS_REUNIAO_ABERTA }, type: QueryTypes.SELECT }
      );

      if (reuniaoAberta) {
        return res.status(409).json({
          message: "Ja existe uma reuniao em aberto para este condominio. Cancele ou encerre a reuniao atual antes de criar uma nova.",
          reuniao_em_aberto: { id: reuniaoAberta.id, titulo: reuniaoAberta.titulo, status: reuniaoAberta.status }
        });
      }

      const [rows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_reuniao
            (id_condominio, titulo, descricao, tipo, data_hora, local, link_online,
             data_limite_confirmacao, participantes, status, id_usuario_criador, created_at, updated_at)
          VALUES
            (:id_condominio, :titulo, :descricao, :tipo, :data_hora, :local, :link_online,
             :data_limite_confirmacao, :participantes, 'CRIADA', :id_usuario_criador, now(), now())
          RETURNING id`,
        {
          replacements: {
            id_condominio: idCondominio, titulo, descricao, tipo, data_hora: dataHora,
            local, link_online: linkOnline, data_limite_confirmacao: dataLimiteConfirmacao,
            participantes: filtroDestinatarioRaw, id_usuario_criador: idUsuarioCriador
          },
          type: QueryTypes.INSERT
        }
      );

      const idReuniao = rows?.[0]?.id ?? rows?.[0] ?? null;

      if (idReuniao && itensPauta.length > 0) {
        await this._inserirPautas(idReuniao, itensPauta);
      }

      if (notificarMoradores && idReuniao) {
        setImmediate(async () => {
          try {
            const pushWhereParts = ["id_condominio = :id_condominio", "COALESCE(status, '') IN ('ativo', 'Ativo')"];
            const pushReplacements = { id_condominio: idCondominio };
            if (tipoMoradorFiltro) {
              pushWhereParts.push("lower(COALESCE(tipo_morador, '')) = :tipo_morador");
              pushReplacements.tipo_morador = tipoMoradorFiltro;
            }
            const moradores = await postgres.query(
              `SELECT id FROM "condominio-bh"."tb-usuarios" WHERE ${pushWhereParts.join(' AND ')}`,
              { replacements: pushReplacements, type: QueryTypes.SELECT }
            );
            const ids = moradores.map((m) => m.id).filter(Boolean);
            if (ids.length === 0) return;
            await pushNotificationService.enviarParaUsuarios(ids, {
              title: "Reuniao convocada!",
              body: titulo,
              sound: "default",
              data: { tipo: "reuniao", id: idReuniao, rota: "/reunioes" }
            });
          } catch { /* Push nao impede o fluxo principal. */ }
        });
      }

      if (enviarEmail && idReuniao) {
        waitUntil((async () => {
          try {
            const emailWhereParts = [
              "u.id_condominio = :id_condominio",
              "LOWER(u.status) = 'ativo'",
              "COALESCE(p.nome, '') NOT IN ('Portaria', 'Colaborador')",
              "u.email IS NOT NULL AND u.email <> ''",
            ];
            const emailReplacements = { id_condominio: idCondominio };
            if (tipoMoradorFiltro) {
              emailWhereParts.push("lower(COALESCE(u.tipo_morador, '')) = :tipo_morador");
              emailReplacements.tipo_morador = tipoMoradorFiltro;
            }
            const destinatarios = await postgres.query(
              `SELECT DISTINCT u.id, u.nome, u.email, c.nome AS condominio_nome
                 FROM "condominio-bh"."tb-usuarios" u
                 LEFT JOIN "condominio-bh".tb_sgw_perfil p ON p.id::text = u.tipo_perfil_id::text
                 LEFT JOIN "condominio-bh"."tb-condominios" c ON c.id::text = u.id_condominio::text
                WHERE ${emailWhereParts.join(' AND ')}`,
              { replacements: emailReplacements, type: QueryTypes.SELECT }
            );

            if (destinatarios.length > 0) {
              await despacharEmail({
                _ref: `reuniao_${idCondominio}_${idReuniao}`,
                template: "reuniao_convocacao",
                emails: destinatarios.map((d) => d.email),
                reuniao: {
                  titulo,
                  tipo,
                  data_hora: dataHora,
                  local: local || "",
                  descricao: descricao || "",
                  condominio_nome: destinatarios[0]?.condominio_nome || "",
                  pauta: itensPauta,
                  data_limite_confirmacao: dataLimiteConfirmacao
                }
              });
            }
          } catch (emailErr) {
            console.error("[reuniaoController.criar] Erro ao enviar e-mail de convocação:", emailErr?.message, emailErr?.stack);
          }
        })());
      }

      return res.status(201).json({ id: idReuniao, message: "Reuniao criada com sucesso." });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao criar reuniao.", detail: error.message });
    }
  }

  async atualizar(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const id = this._toInt(req.params.id, null);
      if (!id) return res.status(400).json({ message: "Parametro id invalido." });

      const { body } = req;
      const titulo = this._normalizarTextoOuNull(body.titulo, 255);
      const dataHora = this._parseDataHora(body.data_hora);
      const tipo = this._normalizarTextoOuNull(body.tipo, 50);
      const status = this._normalizarTextoOuNull(body.status, 50);

      if (!titulo) return res.status(400).json({ message: "Campo titulo e obrigatorio." });
      if (!dataHora) return res.status(400).json({ message: "Campo data_hora invalido." });
      if (tipo && !TIPOS_REUNIAO.has(tipo.toLowerCase())) return res.status(400).json({ message: `Tipo invalido. Use: ${[...TIPOS_REUNIAO].join(", ")}.` });
      if (status && !STATUS_REUNIAO.has(status.toUpperCase())) return res.status(400).json({ message: `Status invalido. Use: ${[...STATUS_REUNIAO].join(", ")}.` });

      const [, affectedRows] = await postgres.query(
        `UPDATE "condominio-bh".tb_reuniao
            SET titulo       = :titulo,
                descricao    = :descricao,
                tipo         = COALESCE(:tipo, tipo),
                data_hora    = :data_hora,
                local        = :local,
                link_online  = :link_online,
                pauta        = :pauta,
                ata          = :ata,
                status       = COALESCE(:status, status),
                updated_at   = now()
          WHERE id = :id AND id_condominio = :id_condominio`,
        {
          replacements: {
            id, id_condominio: idCondominio, titulo,
            descricao: this._normalizarTextoOuNull(body.descricao),
            tipo: tipo ? tipo.toLowerCase() : null,
            data_hora: dataHora,
            local: this._normalizarTextoOuNull(body.local, 255),
            link_online: this._normalizarTextoOuNull(body.link_online, 500),
            pauta: this._normalizarTextoOuNull(body.pauta),
            ata: this._normalizarTextoOuNull(body.ata),
            status: status ? status.toUpperCase() : null
          },
          type: QueryTypes.UPDATE
        }
      );

      if (affectedRows === 0) return res.status(404).json({ message: "Reuniao nao encontrada." });
      return res.status(200).json({ message: "Reuniao atualizada com sucesso." });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao atualizar reuniao.", detail: error.message });
    }
  }

  async atualizarParcial(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const id = this._toInt(req.params.id, null);
      if (!id) return res.status(400).json({ message: "Parametro id invalido." });

      const { body } = req;
      const camposPermitidos = ["titulo", "descricao", "tipo", "data_hora", "local", "link_online", "pauta", "ata", "status"];
      if (!camposPermitidos.some((c) => body[c] !== undefined)) {
        return res.status(400).json({ message: `Informe ao menos um campo: ${camposPermitidos.join(", ")}.` });
      }

      const setParts = ["updated_at = now()"];
      const replacements = { id, id_condominio: idCondominio };

      if (body.titulo !== undefined) {
        const v = this._normalizarTextoOuNull(body.titulo, 255);
        if (!v) return res.status(400).json({ message: "titulo nao pode ser vazio." });
        setParts.push("titulo = :titulo"); replacements.titulo = v;
      }
      if (body.descricao !== undefined) { setParts.push("descricao = :descricao"); replacements.descricao = this._normalizarTextoOuNull(body.descricao); }
      if (body.tipo !== undefined) {
        const v = this._normalizarTextoOuNull(body.tipo, 50);
        if (v && !TIPOS_REUNIAO.has(v.toLowerCase())) return res.status(400).json({ message: `Tipo invalido. Use: ${[...TIPOS_REUNIAO].join(", ")}.` });
        setParts.push("tipo = :tipo"); replacements.tipo = v ? v.toLowerCase() : null;
      }
      if (body.data_hora !== undefined) {
        const v = this._parseDataHora(body.data_hora);
        if (!v) return res.status(400).json({ message: "data_hora invalida." });
        setParts.push("data_hora = :data_hora"); replacements.data_hora = v;
      }
      if (body.local !== undefined) { setParts.push("local = :local"); replacements.local = this._normalizarTextoOuNull(body.local, 255); }
      if (body.link_online !== undefined) { setParts.push("link_online = :link_online"); replacements.link_online = this._normalizarTextoOuNull(body.link_online, 500); }
      if (body.pauta !== undefined) { setParts.push("pauta = :pauta"); replacements.pauta = this._normalizarTextoOuNull(body.pauta); }
      if (body.ata !== undefined) { setParts.push("ata = :ata"); replacements.ata = this._normalizarTextoOuNull(body.ata); }
      if (body.status !== undefined) {
        const v = this._normalizarTextoOuNull(body.status, 50);
        if (v && !STATUS_REUNIAO.has(v.toUpperCase())) return res.status(400).json({ message: "Status invalido." });
        setParts.push("status = :status"); replacements.status = v ? v.toUpperCase() : null;
      }

      const [, affectedRows] = await postgres.query(
        `UPDATE "condominio-bh".tb_reuniao SET ${setParts.join(", ")} WHERE id = :id AND id_condominio = :id_condominio`,
        { replacements, type: QueryTypes.UPDATE }
      );

      if (affectedRows === 0) return res.status(404).json({ message: "Reuniao nao encontrada." });
      return res.status(200).json({ message: "Reuniao atualizada com sucesso." });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao atualizar reuniao.", detail: error.message });
    }
  }

  async cancelar(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const id = this._toInt(req.params.id, null);
      if (!id) return res.status(400).json({ message: "Parametro id invalido." });

      const [, affectedRows] = await postgres.query(
        `UPDATE "condominio-bh".tb_reuniao
            SET status = 'CANCELADA', updated_at = now()
          WHERE id = :id AND id_condominio = :id_condominio AND status <> 'CANCELADA'`,
        { replacements: { id, id_condominio: idCondominio }, type: QueryTypes.UPDATE }
      );

      if (affectedRows === 0) return res.status(404).json({ message: "Reuniao nao encontrada ou ja cancelada." });
      return res.status(200).json({ message: "Reuniao cancelada com sucesso." });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao cancelar reuniao.", detail: error.message });
    }
  }

  async pendenteConfirmacao(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const idUsuario = this._toInt(req.idcliente, null);
      if (!idUsuario) return res.status(403).json({ message: "Token sem id de usuario." });

      const [reuniao] = await postgres.query(
        `SELECT id, titulo, tipo, status, data_hora, local, participantes
           FROM "condominio-bh".tb_reuniao
          WHERE id_condominio = :id_condominio AND status IN (:status_abertos)
          ORDER BY data_hora DESC LIMIT 1`,
        { replacements: { id_condominio: idCondominio, status_abertos: STATUS_REUNIAO_ABERTA }, type: QueryTypes.SELECT }
      );
      if (!reuniao) return res.status(200).json({ reuniao: null });

      const [presenca] = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_reuniao_presenca
          WHERE id_reuniao = :id_reuniao AND id_usuario = :id_usuario LIMIT 1`,
        { replacements: { id_reuniao: reuniao.id, id_usuario: idUsuario }, type: QueryTypes.SELECT }
      );
      if (presenca) return res.status(200).json({ reuniao: null });

      const participantes = (reuniao.participantes || "todos").toLowerCase();
      if (participantes !== "todos") {
        const [usuario] = await postgres.query(
          `SELECT tipo_morador FROM "condominio-bh"."tb-usuarios"
            WHERE id = :id_usuario AND id_condominio = :id_condominio LIMIT 1`,
          { replacements: { id_usuario: idUsuario, id_condominio: idCondominio }, type: QueryTypes.SELECT }
        );
        const tipoMoradorEsperado = TIPO_MORADOR_POR_FILTRO[participantes] || null;
        const tipoMoradorUsuario = (usuario?.tipo_morador || "").toLowerCase();
        if (!tipoMoradorEsperado || tipoMoradorUsuario !== tipoMoradorEsperado) {
          return res.status(200).json({ reuniao: null });
        }
      }

      return res.status(200).json({
        reuniao: {
          id: reuniao.id,
          titulo: reuniao.titulo,
          tipo: reuniao.tipo,
          status: reuniao.status,
          data_hora: reuniao.data_hora,
          local: reuniao.local,
          filtro_destinatario: participantes
        }
      });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao verificar reuniao pendente de confirmacao.", detail: error.message });
    }
  }

  async confirmarPresenca(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const idReuniao = this._toInt(req.params.id, null);
      if (!idReuniao) return res.status(400).json({ message: "Parametro id invalido." });

      const idUsuario = this._toInt(req.idcliente, null);
      if (!idUsuario) return res.status(403).json({ message: "Token sem id de usuario." });

      const presente = req.body.presente !== undefined ? Boolean(req.body.presente) : true;
      const dataCheckin = presente ? (this._normalizarTextoOuNull(req.body.data_checkin) || new Date().toISOString()) : null;

      const [reuniao] = await postgres.query(
        `SELECT id, status FROM "condominio-bh".tb_reuniao
          WHERE id = :id AND id_condominio = :id_condominio LIMIT 1`,
        { replacements: { id: idReuniao, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      if (!reuniao) return res.status(404).json({ message: "Reuniao nao encontrada." });
      if (reuniao.status === "CANCELADA") {
        return res.status(422).json({ message: "Nao e possivel confirmar presenca em reuniao cancelada." });
      }

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_reuniao_presenca
            (id_reuniao, id_usuario, presente, data_checkin)
          VALUES (:id_reuniao, :id_usuario, :presente, :data_checkin)
          ON CONFLICT (id_reuniao, id_usuario)
          DO UPDATE SET presente = EXCLUDED.presente, data_checkin = EXCLUDED.data_checkin`,
        {
          replacements: { id_reuniao: idReuniao, id_usuario: idUsuario, presente, data_checkin: dataCheckin },
          type: QueryTypes.INSERT
        }
      );

      return res.status(200).json({ message: "Presenca registrada com sucesso.", presente, data_checkin: dataCheckin });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao registrar presenca.", detail: error.message });
    }
  }

  async listarPresencas(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: "Token sem id_condominio." });

      const idReuniao = this._toInt(req.params.id, null);
      if (!idReuniao) return res.status(400).json({ message: "Parametro id invalido." });

      const [reuniao] = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_reuniao WHERE id = :id AND id_condominio = :id_condominio LIMIT 1`,
        { replacements: { id: idReuniao, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      if (!reuniao) return res.status(404).json({ message: "Reuniao nao encontrada." });

      const presencas = await postgres.query(
        `SELECT rp.id, rp.id_usuario, tu.nome, tu.sobrenome, tu.apartamento, tu.bloco,
                rp.presente, rp.data_checkin
           FROM "condominio-bh".tb_reuniao_presenca rp
           JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = rp.id_usuario
          WHERE rp.id_reuniao = :id_reuniao ORDER BY tu.nome`,
        { replacements: { id_reuniao: idReuniao }, type: QueryTypes.SELECT }
      );

      const resumo = {
        presentes: presencas.filter((p) => p.presente === true).length,
        ausentes: presencas.filter((p) => p.presente === false).length,
        total: presencas.length
      };

      return res.status(200).json({ id_reuniao: idReuniao, resumo, presencas });
    } catch (error) {
      return res.status(500).json({ message: "Erro ao listar presencas.", detail: error.message });
    }
  }
}

module.exports = ReuniaoController;






