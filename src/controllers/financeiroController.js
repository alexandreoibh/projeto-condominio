'use strict';

const { QueryTypes } = require('sequelize');
const { put } = require('@vercel/blob');
const postgres = require('../database/postgres');
const pushNotificationService = require('../service/pushNotificationService');
const { despacharEmail } = require('../service/emailDispatchService');

const PERFIS_GESTAO = new Set(['Admin', 'Sindico', 'Sub-Sindico']);

class FinanceiroController {
  _toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  _normalizarTextoOuNull(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  }

  _parseDecimalOuNull(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const parsed = Number(String(value).replace(',', '.'));
    return Number.isNaN(parsed) ? null : parsed;
  }

  _periodoAtual() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  _publicApiBaseUrl() {
    return process.env.PUBLIC_API_BASE_URL || 'https://back-projeto-condominio.vercel.app';
  }

  _normalizarPeriodo(valor) {
    if (!valor) return null;
    const match = String(valor).trim().match(/^(\d{4}-\d{2})/);
    return match ? match[1] : null;
  }

  _periodoDaQuery(req) {
    return this._normalizarPeriodo(req.query.competencia) || this._normalizarPeriodo(req.query.periodo);
  }

  _isGestor(req) {
    return PERFIS_GESTAO.has(req.nomePerfil);
  }

  _clausulaOrdenacao(req, whitelist, desempate, padrao) {
    const sortKey = req.query.sort;
    const coluna = whitelist[sortKey];
    if (!coluna) return padrao;
    const order = String(req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    return `${coluna} ${order}, ${desempate}`;
  }

  _calcularVencimentoRotina(diaVencimento, ano, mes) {
    const ultimoDiaMes = new Date(ano, mes, 0).getDate();
    const dia = diaVencimento === 'ultimo_dia'
      ? ultimoDiaMes
      : Math.min(this._toInt(diaVencimento, ultimoDiaMes), ultimoDiaMes);
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  // ─── Grupo de Receita ───────────────────────────────────────────────────────

  async listarGrupoReceita(req, res) {
    try {
      const whereParts = ['ativo = true'];
      const replacements = {};

      if (req.query.origem) {
        whereParts.push('origem = :origem');
        replacements.origem = req.query.origem;
      }

      const data = await postgres.query(
        `SELECT id, codigo, nome, origem, descricao, grupo
           FROM "condominio-bh".tb_fin_grupo_receita
          WHERE ${whereParts.join(' AND ')}
          ORDER BY nome`,
        { replacements, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar grupos de receita.', detail: error.message });
    }
  }

  // ─── Grupo de Despesa ───────────────────────────────────────────────────────

  async listarGrupoDespesa(req, res) {
    try {
      const whereParts = ['ativo = true'];
      const replacements = {};

      if (req.query.origem) {
        whereParts.push('origem = :origem');
        replacements.origem = req.query.origem;
      }

      const data = await postgres.query(
        `SELECT id, codigo, nome, origem, descricao, grupo
           FROM "condominio-bh".tb_fin_grupo_despesa
          WHERE ${whereParts.join(' AND ')}
          ORDER BY nome`,
        { replacements, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar grupos de despesa.', detail: error.message });
    }
  }

  // ─── Receitas ───────────────────────────────────────────────────────────────

  async listarReceitas(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const whereParts = ['r.id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio, limit: pageSize, offset };

      const periodoReceitas = this._periodoDaQuery(req);
      if (periodoReceitas) {
        whereParts.push("TO_CHAR(r.competencia, 'YYYY-MM') = :periodo");
        replacements.periodo = periodoReceitas;
      }
      if (req.query.categoria) {
        whereParts.push('r.categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }
      if (req.query.situacao) {
        whereParts.push('r.situacao = :situacao');
        replacements.situacao = req.query.situacao;
      }
      if (req.query.id_grupo_receita) {
        whereParts.push('r.id_grupo_receita = :id_grupo_receita');
        replacements.id_grupo_receita = this._toInt(req.query.id_grupo_receita, null);
      }

      const whereClause = whereParts.join(' AND ');

      const receitasSortWhitelist = {
        id: 'r.id',
        unidade: 'tcu.unidades_bloco',
        morador: 'us.nome',
        categoria: 'r.categoria',
        situacao: 'r.situacao',
        valor_total: '(r.valor + COALESCE(r.valor_fundo_reserva, 0))',
      };
      const desempate = req.query.sort === 'categoria'
        ? 'tcu.unidades_bloco ASC'
        : 'tcu.unidades_bloco DESC';
      const orderByClause = this._clausulaOrdenacao(
        req,
        receitasSortWhitelist,
        desempate,
        'r.data_vencimento DESC, r.id DESC'
      );

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total FROM "condominio-bh".tb_fin_receitas r WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT r.*,
                  us.nome,
                  us.bloco,
                  us.apartamento
             FROM "condominio-bh".tb_fin_receitas r
             LEFT JOIN "condominio-bh".tb_condominios_unidades tcu
               ON tcu.id = r.id_unidade AND tcu.id_condominio = r.id_condominio
             LEFT JOIN (
               SELECT DISTINCT ON (id_condominio, apartamento) *
                 FROM "condominio-bh"."tb-usuarios"
                WHERE status = 'ativo'
                ORDER BY id_condominio, apartamento, id
             ) us ON us.id_condominio = tcu.id_condominio AND us.apartamento = tcu.unidades_bloco
            WHERE ${whereClause}
            ORDER BY ${orderByClause}
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const total = totalRows[0]?.total || 0;
      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        data,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar receitas.', detail: error.message });
    }
  }

  async criarReceita(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const {
        descricao, valor, valor_fundo_reserva, competencia, data_vencimento,
        data_pagamento, situacao, id_grupo_receita, id_usuario, id_unidade,
        numero_documento, observacao,
        is_rotina, rotina_dia_vencimento, rotina_data_fim,
      } = req.body;

      const grupoRows = await postgres.query(
        `SELECT id, nome, origem, grupo FROM "condominio-bh".tb_fin_grupo_receita WHERE id = :id LIMIT 1`,
        { replacements: { id: this._toInt(id_grupo_receita, null) }, type: QueryTypes.SELECT }
      );
      if (!grupoRows[0]) return res.status(422).json({ message: 'id_grupo_receita não encontrado.' });

      const grupo = grupoRows[0];
      const idUsuario = this._toInt(id_usuario, null);
      const idUnidade = this._toInt(id_unidade, null);

      const isRotina = is_rotina === true || is_rotina === 'true';
      let idRotina = null;

      if (isRotina) {
        const diaVencimentoTexto = String(rotina_dia_vencimento || '').trim();
        const diaValido = diaVencimentoTexto === 'ultimo_dia'
          || (/^\d{1,2}$/.test(diaVencimentoTexto) && this._toInt(diaVencimentoTexto, 0) >= 1 && this._toInt(diaVencimentoTexto, 0) <= 31);
        if (!diaValido) {
          return res.status(422).json({ message: 'rotina_dia_vencimento deve ser um número de 1 a 31 ou "ultimo_dia".' });
        }

        const [rotinaRows] = await postgres.query(
          `INSERT INTO "condominio-bh".tb_fin_receita_rotina (
              id_condominio, dia_vencimento, data_fim, ativo, id_usuario_cadastro, created_at, updated_at
            ) VALUES (
              :id_condominio, :dia_vencimento, :data_fim::date, true, :id_usuario_cadastro, now(), now()
            ) RETURNING id`,
          {
            replacements: {
              id_condominio: idCondominio,
              dia_vencimento: diaVencimentoTexto,
              data_fim: this._normalizarTextoOuNull(rotina_data_fim),
              id_usuario_cadastro: this._toInt(req.idcliente, null),
            },
          }
        );
        idRotina = rotinaRows[0].id;
      }

      const [rows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_receitas (
            id_condominio, id_unidade, id_usuario, id_usuario_cadastro, categoria, descricao, valor,
            valor_fundo_reserva,
            competencia, data_vencimento, data_pagamento, situacao,
            id_grupo_receita, id_categoria, grupo_receita,
            numero_documento, observacao, id_rotina, created_at, updated_at
          ) VALUES (
            :id_condominio, :id_unidade, :id_usuario, :id_usuario_cadastro, :categoria, :descricao, :valor,
            :valor_fundo_reserva,
            :competencia::date, :data_vencimento::date, :data_pagamento::date, :situacao,
            :id_grupo_receita, :id_categoria, :grupo_receita,
            :numero_documento, :observacao, :id_rotina, now(), now()
          ) RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominio,
            id_unidade: idUnidade,
            id_usuario: idUsuario,
            id_usuario_cadastro: this._toInt(req.idcliente, null),
            categoria: grupo.nome,
            descricao: this._normalizarTextoOuNull(descricao),
            valor: this._parseDecimalOuNull(valor),
            valor_fundo_reserva: this._parseDecimalOuNull(valor_fundo_reserva),
            competencia,
            data_vencimento,
            data_pagamento: this._normalizarTextoOuNull(data_pagamento),
            situacao: situacao || 'em_aberto',
            id_grupo_receita: grupo.id,
            id_categoria: String(grupo.id),
            grupo_receita: grupo.origem,
            numero_documento: this._normalizarTextoOuNull(numero_documento),
            observacao: this._normalizarTextoOuNull(observacao),
            id_rotina: idRotina,
          },
        }
      );

      return res.status(201).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao criar receita.', detail: error.message });
    }
  }

  async listarRotinasReceita(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const data = await postgres.query(
        `SELECT rot.id, rot.dia_vencimento, rot.data_fim, rot.ativo, rot.created_at,
                r.categoria, r.descricao, r.valor, r.valor_fundo_reserva, r.id_usuario, r.id_unidade, r.id_grupo_receita,
                us.nome, us.bloco, us.apartamento
           FROM "condominio-bh".tb_fin_receita_rotina rot
           LEFT JOIN (
             SELECT DISTINCT ON (id_rotina) id_rotina, categoria, descricao, valor, valor_fundo_reserva, id_usuario, id_unidade, id_grupo_receita
               FROM "condominio-bh".tb_fin_receitas
              WHERE id_rotina IS NOT NULL
              ORDER BY id_rotina, id DESC
           ) r ON r.id_rotina = rot.id
           LEFT JOIN "condominio-bh".tb_condominios_unidades tcu
             ON tcu.id = r.id_unidade AND tcu.id_condominio = rot.id_condominio
           LEFT JOIN (
             SELECT DISTINCT ON (id_condominio, apartamento) *
               FROM "condominio-bh"."tb-usuarios"
              WHERE status = 'ativo'
              ORDER BY id_condominio, apartamento, id
           ) us ON us.id_condominio = tcu.id_condominio AND us.apartamento = tcu.unidades_bloco
          WHERE rot.id_condominio = :id_condominio
          ORDER BY rot.ativo DESC, rot.created_at DESC`,
        { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar rotinas de receita.', detail: error.message });
    }
  }

  async cancelarRotinaReceita(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_receita_rotina
            SET ativo = false, updated_at = now()
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING id`,
        { replacements: { id, id_condominio: idCondominio } }
      );
      if (!rows[0]) return res.status(404).json({ message: 'Rotina não encontrada.' });

      return res.status(200).json({ message: 'Rotina cancelada com sucesso.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao cancelar rotina de receita.', detail: error.message });
    }
  }

  async atualizarReceita(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);
      const campos = ['updated_at = now()'];
      const replacements = { id, id_condominio: idCondominio };

      const camposDatas = new Set(['competencia', 'data_vencimento', 'data_pagamento']);
      const camposInt = new Set(['id_grupo_receita']);
      const camposDecimais = new Set(['valor', 'valor_fundo_reserva']);
      const camposPermitidos = [
        'categoria', 'descricao', 'valor', 'valor_fundo_reserva', 'competencia', 'data_vencimento', 'data_pagamento',
        'situacao', 'id_grupo_receita', 'id_categoria', 'grupo_receita', 'numero_documento', 'observacao',
      ];

      for (const campo of camposPermitidos) {
        if (req.body[campo] !== undefined) {
          if (camposDatas.has(campo)) {
            campos.push(`${campo} = :${campo}::date`);
            replacements[campo] = this._normalizarTextoOuNull(req.body[campo]);
          } else if (camposDecimais.has(campo)) {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._parseDecimalOuNull(req.body[campo]);
          } else if (camposInt.has(campo)) {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._toInt(req.body[campo], null);
          } else {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizarTextoOuNull(req.body[campo]);
          }
        }
      }

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_receitas
            SET ${campos.join(', ')}
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING *`,
        { replacements }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Receita não encontrada.' });
      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar receita.', detail: error.message });
    }
  }

  async excluirReceita(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_receitas
            SET situacao = 'cancelado', updated_at = now()
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING id`,
        { replacements: { id, id_condominio: idCondominio } }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Receita não encontrada.' });
      return res.status(200).json({ message: 'Receita cancelada.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao excluir receita.', detail: error.message });
    }
  }

  async consolidadoReceitas(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const periodoInicio = this._normalizarPeriodo(req.query.periodo_inicio);
      const periodoFim = this._normalizarPeriodo(req.query.periodo_fim);
      if (periodoInicio && periodoFim) {
        return this._consolidadoReceitasSerie(req, res, idCondominio, periodoInicio, periodoFim);
      }

      const whereParts = ['id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio };

      const periodo = this._periodoDaQuery(req);
      if (periodo) {
        whereParts.push("TO_CHAR(competencia, 'YYYY-MM') = :periodo");
        replacements.periodo = periodo;
      }
      if (req.query.categoria) {
        whereParts.push('categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }
      if (req.query.id_grupo_receita) {
        whereParts.push('id_grupo_receita = :id_grupo_receita');
        replacements.id_grupo_receita = this._toInt(req.query.id_grupo_receita, null);
      }

      const rows = await postgres.query(
        `SELECT
            COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor ELSE 0 END), 0)::numeric AS soma_pago,
            COALESCE(SUM(CASE WHEN situacao = 'em_aberto' THEN valor ELSE 0 END), 0)::numeric AS soma_em_aberto,
            COALESCE(MAX(CASE WHEN situacao = 'pago' THEN valor + COALESCE(valor_fundo_reserva, 0) END), 0)::numeric AS maior_pago,
            COALESCE(MAX(CASE WHEN situacao = 'em_aberto' THEN valor + COALESCE(valor_fundo_reserva, 0) END), 0)::numeric AS maior_em_aberto,
            COALESCE(SUM(CASE WHEN situacao = 'pago' THEN 1 ELSE 0 END), 0)::int AS qtd_pago,
            COALESCE(SUM(CASE WHEN situacao = 'em_aberto' THEN 1 ELSE 0 END), 0)::int AS qtd_em_aberto,
            COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS soma_fundo_reserva_pago,
            COALESCE(SUM(CASE WHEN situacao = 'em_aberto' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS soma_fundo_reserva_em_aberto,
            COALESCE(SUM(CASE WHEN situacao = 'pago' AND DATE_TRUNC('month', data_pagamento) = DATE_TRUNC('month', competencia)
                           THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS recebido_no_periodo,
            COALESCE(SUM(CASE WHEN situacao = 'pago' AND DATE_TRUNC('month', data_pagamento) != DATE_TRUNC('month', competencia)
                           THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS recebido_fora_periodo,
            COALESCE(SUM(CASE WHEN situacao = 'pago' AND DATE_TRUNC('month', data_pagamento) = DATE_TRUNC('month', competencia)
                           THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS recebido_no_periodo_fundo_reserva,
            COALESCE(SUM(CASE WHEN situacao = 'pago' AND DATE_TRUNC('month', data_pagamento) != DATE_TRUNC('month', competencia)
                           THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS recebido_fora_periodo_fundo_reserva
           FROM "condominio-bh".tb_fin_receitas
          WHERE ${whereParts.join(' AND ')}`,
        { replacements, type: QueryTypes.SELECT }
      );

      const resumo = rows[0] || {};
      const receitaPago = Number(resumo.soma_pago || 0);
      const fundoReservaPago = Number(resumo.soma_fundo_reserva_pago || 0);
      const receitaEmAberto = Number(resumo.soma_em_aberto || 0);
      const fundoReservaEmAberto = Number(resumo.soma_fundo_reserva_em_aberto || 0);
      const totalPago = receitaPago + fundoReservaPago;
      const totalEmAberto = receitaEmAberto + fundoReservaEmAberto;

      return res.status(200).json({
        total_lancado: totalPago + totalEmAberto,
        pago: {
          quantidade: Number(resumo.qtd_pago || 0),
          receita: receitaPago,
          fundo_reserva: fundoReservaPago,
          total: totalPago,
          maior_valor: Number(resumo.maior_pago || 0),
          recebido_no_periodo: Number(resumo.recebido_no_periodo || 0),
          recebido_no_periodo_fundo_reserva: Number(resumo.recebido_no_periodo_fundo_reserva || 0),
          recebido_fora_periodo: Number(resumo.recebido_fora_periodo || 0),
          recebido_fora_periodo_fundo_reserva: Number(resumo.recebido_fora_periodo_fundo_reserva || 0),
        },
        em_aberto: {
          quantidade: Number(resumo.qtd_em_aberto || 0),
          receita: receitaEmAberto,
          fundo_reserva: fundoReservaEmAberto,
          total: totalEmAberto,
          maior_valor: Number(resumo.maior_em_aberto || 0),
        },
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao consolidar receitas.', detail: error.message });
    }
  }

  _mesesNoIntervalo(periodoInicio, periodoFim) {
    const [anoIni, mesIni] = periodoInicio.split('-').map(Number);
    const [anoFim, mesFim] = periodoFim.split('-').map(Number);
    return (anoFim - anoIni) * 12 + (mesFim - mesIni) + 1;
  }

  async _consolidadoReceitasSerie(req, res, idCondominio, periodoInicio, periodoFim) {
    try {
      if (periodoInicio > periodoFim) {
        return res.status(422).json({ message: 'periodo_inicio deve ser anterior ou igual a periodo_fim.' });
      }
      if (this._mesesNoIntervalo(periodoInicio, periodoFim) > 36) {
        return res.status(422).json({ message: 'Intervalo máximo permitido é de 36 meses.' });
      }

      const filtrosExtra = [];
      const replacements = { id_condominio: idCondominio, periodo_inicio: periodoInicio, periodo_fim: periodoFim };

      if (req.query.categoria) {
        filtrosExtra.push('AND r.categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }
      if (req.query.id_grupo_receita) {
        filtrosExtra.push('AND r.id_grupo_receita = :id_grupo_receita');
        replacements.id_grupo_receita = this._toInt(req.query.id_grupo_receita, null);
      }

      const rows = await postgres.query(
        `SELECT
            TO_CHAR(meses.mes, 'YYYY-MM') AS mes,
            COALESCE(SUM(CASE WHEN r.situacao = 'pago' THEN r.valor + COALESCE(r.valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS soma_pago,
            COALESCE(SUM(CASE WHEN r.situacao = 'em_aberto' THEN r.valor + COALESCE(r.valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS soma_em_aberto,
            COALESCE(SUM(CASE WHEN r.situacao = 'pago' THEN r.valor_fundo_reserva ELSE 0 END), 0)::numeric AS soma_fundo_reserva_pago,
            COALESCE(SUM(CASE WHEN r.situacao = 'em_aberto' THEN r.valor_fundo_reserva ELSE 0 END), 0)::numeric AS soma_fundo_reserva_em_aberto,
            COALESCE(SUM(CASE WHEN r.situacao = 'pago' THEN 1 ELSE 0 END), 0)::int AS qtd_pago,
            COALESCE(SUM(CASE WHEN r.situacao = 'em_aberto' THEN 1 ELSE 0 END), 0)::int AS qtd_em_aberto
           FROM generate_series(TO_DATE(:periodo_inicio, 'YYYY-MM'), TO_DATE(:periodo_fim, 'YYYY-MM'), INTERVAL '1 month') AS meses(mes)
           LEFT JOIN "condominio-bh".tb_fin_receitas r
             ON r.id_condominio = :id_condominio
            AND (
                 (r.situacao = 'pago' AND DATE_TRUNC('month', r.data_pagamento) = meses.mes)
              OR (r.situacao != 'pago' AND DATE_TRUNC('month', r.competencia) = meses.mes)
            )
            ${filtrosExtra.join(' ')}
          GROUP BY meses.mes
          ORDER BY meses.mes`,
        { replacements, type: QueryTypes.SELECT }
      );

      return res.status(200).json({
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
        data: rows.map((item) => ({
          mes: item.mes,
          soma_pago: Number(item.soma_pago || 0),
          soma_em_aberto: Number(item.soma_em_aberto || 0),
          soma_fundo_reserva_pago: Number(item.soma_fundo_reserva_pago || 0),
          soma_fundo_reserva_em_aberto: Number(item.soma_fundo_reserva_em_aberto || 0),
          qtd_pago: Number(item.qtd_pago || 0),
          qtd_em_aberto: Number(item.qtd_em_aberto || 0),
        })),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao consolidar série de receitas.', detail: error.message });
    }
  }

  // ─── Despesas ───────────────────────────────────────────────────────────────

  async listarDespesas(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const whereParts = ['d.id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio, limit: pageSize, offset };

      const periodoDespesas = this._periodoDaQuery(req);
      if (periodoDespesas) {
        whereParts.push("TO_CHAR(d.competencia, 'YYYY-MM') = :periodo");
        replacements.periodo = periodoDespesas;
      }
      if (req.query.categoria) {
        whereParts.push('d.categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }
      if (req.query.situacao) {
        whereParts.push('d.situacao = :situacao');
        replacements.situacao = req.query.situacao;
      }

      const whereClause = whereParts.join(' AND ');

      const despesasSortWhitelist = {
        id: 'd.id',
        fornecedor: 'd.fornecedor',
        categoria: 'g.nome',
        situacao: 'd.situacao',
        valor: 'd.valor',
      };
      const orderByClause = this._clausulaOrdenacao(
        req,
        despesasSortWhitelist,
        'd.id DESC',
        'd.data_despesa DESC, d.id DESC'
      );

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total
             FROM "condominio-bh".tb_fin_despesas d
            LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
            WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT d.*,
                  g.codigo AS grupo_despesa_codigo,
                  g.nome AS grupo_despesa_nome,
                  g.descricao AS grupo_despesa_descricao,
                  g.origem AS grupo_despesa_origem,
                  g.grupo AS grupo_despesa_grupo,
                  COALESCE(
                    (SELECT array_to_json(array_agg(row_to_json(doc) ORDER BY doc.id))
                       FROM "condominio-bh".tb_fin_despesas_documentos doc
                      WHERE doc.id_despesa = d.id),
                    '[]'::json
                  ) AS documentos
             FROM "condominio-bh".tb_fin_despesas d
            LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
            WHERE ${whereClause}
            ORDER BY ${orderByClause}
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const total = totalRows[0]?.total || 0;
      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        data,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar despesas.', detail: error.message });
    }
  }

  async consolidadoDespesas(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const periodoInicio = this._normalizarPeriodo(req.query.periodo_inicio);
      const periodoFim = this._normalizarPeriodo(req.query.periodo_fim);
      if (periodoInicio && periodoFim) {
        return this._consolidadoDespesasSerie(req, res, idCondominio, periodoInicio, periodoFim);
      }

      const whereParts = ['d.id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio };

      const periodo = this._periodoDaQuery(req);
      if (periodo) {
        whereParts.push(`(
             (d.situacao = 'pago' AND TO_CHAR(d.data_pagamento, 'YYYY-MM') = :periodo)
          OR (d.situacao != 'pago' AND TO_CHAR(d.competencia, 'YYYY-MM') = :periodo)
        )`);
        replacements.periodo = periodo;
      }
      if (req.query.categoria) {
        whereParts.push('d.categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }

      const rows = await postgres.query(
        `SELECT
            COALESCE(SUM(CASE WHEN d.situacao = 'pago' THEN d.valor ELSE 0 END), 0)::numeric AS soma_pago,
            COALESCE(SUM(CASE WHEN d.situacao = 'a_pagar' THEN d.valor ELSE 0 END), 0)::numeric AS soma_em_aberto,
            COALESCE(MAX(CASE WHEN d.situacao = 'pago' THEN d.valor END), 0)::numeric AS maior_pago,
            COALESCE(MAX(CASE WHEN d.situacao = 'a_pagar' THEN d.valor END), 0)::numeric AS maior_em_aberto,
            COALESCE(SUM(CASE WHEN d.situacao = 'pago' THEN 1 ELSE 0 END), 0)::int AS qtd_pago,
            COALESCE(SUM(CASE WHEN d.situacao = 'a_pagar' THEN 1 ELSE 0 END), 0)::int AS qtd_em_aberto
           FROM "condominio-bh".tb_fin_despesas d
          LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
          WHERE ${whereParts.join(' AND ')}`,
        { replacements, type: QueryTypes.SELECT }
      );

      const resumo = rows[0] || {};
      return res.status(200).json({
        soma_pago: Number(resumo.soma_pago || 0),
        soma_em_aberto: Number(resumo.soma_em_aberto || 0),
        maior_pago: Number(resumo.maior_pago || 0),
        maior_em_aberto: Number(resumo.maior_em_aberto || 0),
        qtd_pago: Number(resumo.qtd_pago || 0),
        qtd_em_aberto: Number(resumo.qtd_em_aberto || 0),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao consolidar despesas.', detail: error.message });
    }
  }

  async _consolidadoDespesasSerie(req, res, idCondominio, periodoInicio, periodoFim) {
    try {
      if (periodoInicio > periodoFim) {
        return res.status(422).json({ message: 'periodo_inicio deve ser anterior ou igual a periodo_fim.' });
      }
      if (this._mesesNoIntervalo(periodoInicio, periodoFim) > 36) {
        return res.status(422).json({ message: 'Intervalo máximo permitido é de 36 meses.' });
      }

      const filtrosExtra = [];
      const replacements = { id_condominio: idCondominio, periodo_inicio: periodoInicio, periodo_fim: periodoFim };

      if (req.query.categoria) {
        filtrosExtra.push('AND d.categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }

      const rows = await postgres.query(
        `SELECT
            TO_CHAR(meses.mes, 'YYYY-MM') AS mes,
            COALESCE(SUM(CASE WHEN d.situacao = 'pago' THEN d.valor ELSE 0 END), 0)::numeric AS soma_pago,
            COALESCE(SUM(CASE WHEN d.situacao = 'a_pagar' THEN d.valor ELSE 0 END), 0)::numeric AS soma_em_aberto,
            COALESCE(SUM(CASE WHEN d.situacao = 'pago' THEN 1 ELSE 0 END), 0)::int AS qtd_pago,
            COALESCE(SUM(CASE WHEN d.situacao = 'a_pagar' THEN 1 ELSE 0 END), 0)::int AS qtd_em_aberto
           FROM generate_series(TO_DATE(:periodo_inicio, 'YYYY-MM'), TO_DATE(:periodo_fim, 'YYYY-MM'), INTERVAL '1 month') AS meses(mes)
           LEFT JOIN "condominio-bh".tb_fin_despesas d
             ON d.id_condominio = :id_condominio
            AND (
                 (d.situacao = 'pago' AND DATE_TRUNC('month', d.data_pagamento) = meses.mes)
              OR (d.situacao != 'pago' AND DATE_TRUNC('month', d.competencia) = meses.mes)
            )
            ${filtrosExtra.join(' ')}
          GROUP BY meses.mes
          ORDER BY meses.mes`,
        { replacements, type: QueryTypes.SELECT }
      );

      return res.status(200).json({
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
        data: rows.map((item) => ({
          mes: item.mes,
          soma_pago: Number(item.soma_pago || 0),
          soma_em_aberto: Number(item.soma_em_aberto || 0),
          qtd_pago: Number(item.qtd_pago || 0),
          qtd_em_aberto: Number(item.qtd_em_aberto || 0),
        })),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao consolidar série de despesas.', detail: error.message });
    }
  }

  async criarDespesa(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const {
        fornecedor, categoria, descricao, valor, competencia,
        data_despesa, data_pagamento, forma_pagamento, situacao,
        numero_documento, observacao,
      } = req.body;

      const [rows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_despesas (
            id_condominio, fornecedor, categoria, descricao, valor,
            competencia, data_despesa, data_pagamento, forma_pagamento,
            situacao, numero_documento, observacao, created_at, updated_at
          ) VALUES (
            :id_condominio, :fornecedor, :categoria, :descricao, :valor,
            :competencia::date, :data_despesa::date, :data_pagamento::date,
            :forma_pagamento, :situacao, :numero_documento, :observacao, now(), now()
          ) RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominio,
            fornecedor: this._normalizarTextoOuNull(fornecedor),
            categoria,
            descricao: this._normalizarTextoOuNull(descricao) ?? '',
            valor: this._parseDecimalOuNull(valor),
            competencia,
            data_despesa,
            data_pagamento: this._normalizarTextoOuNull(data_pagamento),
            forma_pagamento: this._normalizarTextoOuNull(forma_pagamento),
            situacao: situacao || 'a_pagar',
            numero_documento: this._normalizarTextoOuNull(numero_documento),
            observacao: this._normalizarTextoOuNull(observacao),
          },
        }
      );

      return res.status(201).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao criar despesa.', detail: error.message });
    }
  }

  async atualizarDespesa(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);
      const campos = ['updated_at = now()'];
      const replacements = { id, id_condominio: idCondominio };

      const camposDatas = new Set(['competencia', 'data_despesa', 'data_pagamento']);
      const camposPermitidos = ['fornecedor', 'categoria', 'descricao', 'valor', 'competencia', 'data_despesa', 'data_pagamento', 'forma_pagamento', 'situacao', 'numero_documento', 'observacao'];

      for (const campo of camposPermitidos) {
        if (req.body[campo] !== undefined) {
          if (camposDatas.has(campo)) {
            campos.push(`${campo} = :${campo}::date`);
            replacements[campo] = this._normalizarTextoOuNull(req.body[campo]);
          } else if (campo === 'valor') {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._parseDecimalOuNull(req.body[campo]);
          } else if (campo === 'descricao') {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizarTextoOuNull(req.body[campo]) ?? '';
          } else {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizarTextoOuNull(req.body[campo]);
          }
        }
      }

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_despesas
            SET ${campos.join(', ')}
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING *`,
        { replacements }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Despesa não encontrada.' });
      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar despesa.', detail: error.message });
    }
  }

  async excluirDespesa(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_despesas
            SET situacao = 'cancelado', updated_at = now()
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING id`,
        { replacements: { id, id_condominio: idCondominio } }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Despesa não encontrada.' });
      return res.status(200).json({ message: 'Despesa cancelada.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao excluir despesa.', detail: error.message });
    }
  }

  async listarDocumentosDespesa(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const idDespesa = this._toInt(req.params.id, null);

      const despesas = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_fin_despesas WHERE id = :id AND id_condominio = :id_condominio`,
        { replacements: { id: idDespesa, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );
      if (!despesas[0]) return res.status(404).json({ message: 'Despesa não encontrada.' });

      const data = await postgres.query(
        `SELECT id, tipo, nome_arquivo, caminho_arquivo, data_envio
           FROM "condominio-bh".tb_fin_despesas_documentos
          WHERE id_despesa = :id_despesa
          ORDER BY data_envio DESC`,
        { replacements: { id_despesa: idDespesa }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar documentos da despesa.', detail: error.message });
    }
  }

  async uploadDocumentoDespesa(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });

      const idDespesa = this._toInt(req.params.id, null);
      const tipo = req.body.tipo;

      const despesas = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_fin_despesas WHERE id = :id AND id_condominio = :id_condominio`,
        { replacements: { id: idDespesa, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );
      if (!despesas[0]) return res.status(404).json({ message: 'Despesa não encontrada.' });

      const arquivo = req.file;
      const ext = (arquivo.originalname.split('.').pop() || 'bin').toLowerCase();
      const ambiente = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
      const nomeArquivo = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
      const blobPath = `${ambiente}/condominios/${idCondominio}/financeiro/despesas/${idDespesa}/${nomeArquivo}`;

      const uploadResult = await put(blobPath, arquivo.buffer, { access: 'private', contentType: arquivo.mimetype });
      const caminhoArquivo = uploadResult?.url || blobPath;

      const [docRows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_despesas_documentos
            (id_despesa, tipo, nome_arquivo, caminho_arquivo, data_envio)
           VALUES (:id_despesa, :tipo, :nome_arquivo, :caminho_arquivo, now())
           RETURNING *`,
        {
          replacements: {
            id_despesa: idDespesa,
            tipo,
            nome_arquivo: arquivo.originalname,
            caminho_arquivo: caminhoArquivo,
          },
        }
      );

      return res.status(201).json(docRows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao fazer upload do documento.', detail: error.message });
    }
  }

  async uploadBoletoCobranca(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });
      if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });

      const arquivo = req.file;
      const ext = (arquivo.originalname.split('.').pop() || 'bin').toLowerCase();
      const anomes = this._periodoAtual().replace('-', '');
      const nomeArquivo = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
      const blobPath = `cobranca/boletos/condominio-${idCondominio}/${anomes}/${nomeArquivo}`;

      const uploadResult = await put(blobPath, arquivo.buffer, { access: 'private', contentType: arquivo.mimetype });
      const url = uploadResult?.url || blobPath;

      return res.status(201).json({ url, blob_path: blobPath, nome_arquivo: arquivo.originalname });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao enviar boleto.', detail: error.message });
    }
  }

  async downloadBoletoCobranca(req, res) {
    try {
      const url = String(req.query.url || '');
      const baseBlobUrl = process.env.BLOB_STORAGE_URL || '';

      if (!url || !baseBlobUrl || !url.startsWith(baseBlobUrl) || !url.includes('/cobranca/boletos/')) {
        return res.status(400).json({ message: 'Parâmetro url inválido.' });
      }

      const blobResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });

      if (!blobResponse.ok) {
        return res.status(blobResponse.status).json({ message: 'Falha ao obter o boleto.' });
      }

      const nomeArquivo = url.split('/').pop() || 'boleto.pdf';
      const buffer = Buffer.from(await blobResponse.arrayBuffer());

      res.setHeader('Content-Type', blobResponse.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
      return res.status(200).send(buffer);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao baixar boleto.', detail: error.message });
    }
  }

  async downloadDocumentoFinanceiro(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const url = String(req.query.url || '');
      const baseBlobUrl = process.env.BLOB_STORAGE_URL || '';

      const caminhoValido = url.includes('/financeiro/despesas/') || url.includes('/financeiro/competencias/');
      if (!url || !baseBlobUrl || !url.startsWith(baseBlobUrl) || !caminhoValido) {
        return res.status(400).json({ message: 'Parâmetro url inválido.' });
      }

      const blobResponse = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });

      if (!blobResponse.ok) {
        return res.status(blobResponse.status).json({ message: 'Falha ao obter o documento.' });
      }

      const nomeArquivo = url.split('/').pop() || 'documento';
      const buffer = Buffer.from(await blobResponse.arrayBuffer());

      res.setHeader('Content-Type', blobResponse.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);
      return res.status(200).send(buffer);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao baixar documento.', detail: error.message });
    }
  }

  async excluirDocumentoDespesa(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const idDespesa = this._toInt(req.params.id, null);
      const idDoc = this._toInt(req.params.docId, null);

      const docs = await postgres.query(
        `SELECT doc.id, doc.caminho_arquivo
           FROM "condominio-bh".tb_fin_despesas_documentos doc
           JOIN "condominio-bh".tb_fin_despesas d ON d.id = doc.id_despesa
          WHERE doc.id = :id_doc AND doc.id_despesa = :id_despesa AND d.id_condominio = :id_condominio`,
        { replacements: { id_doc: idDoc, id_despesa: idDespesa, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      if (!docs[0]) return res.status(404).json({ message: 'Documento não encontrado.' });

      try {
        const { del } = require('@vercel/blob');
        await del(docs[0].caminho_arquivo);
      } catch (_) {
        // remoção do blob é melhor esforço
      }

      await postgres.query(
        `DELETE FROM "condominio-bh".tb_fin_despesas_documentos WHERE id = :id`,
        { replacements: { id: idDoc } }
      );

      return res.status(200).json({ message: 'Documento removido.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao remover documento.', detail: error.message });
    }
  }

  // ─── Dashboard ───────────────────────────────────────────────────────────────

  async getDashboard(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const periodo = this._periodoDaQuery(req) || this._periodoAtual();
      const rpl = { id_condominio: idCondominio, periodo };

      const [kpisReceitas, kpisDespesas, ultimasDespesas, topInadimplentes, grafico, distribuicaoDespesas] = await Promise.all([
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total_receitas,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total_recebido,
              COALESCE(SUM(CASE WHEN situacao = 'em_aberto' AND data_vencimento < CURRENT_DATE THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total_inadimplente
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END), 0)::numeric AS total_despesas,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor ELSE 0 END), 0)::numeric AS total_pago
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT d.id, d.descricao, d.categoria, d.valor, d.situacao, d.data_despesa, d.fornecedor,
                  g.nome AS grupo_despesa_nome,
                  g.descricao AS grupo_despesa_descricao
             FROM "condominio-bh".tb_fin_despesas d
            LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
            WHERE d.id_condominio = :id_condominio
              AND TO_CHAR(d.competencia, 'YYYY-MM') = :periodo
              AND d.situacao != 'cancelado'
            ORDER BY d.data_despesa DESC
            LIMIT 5`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT r.id, r.descricao, r.valor, r.valor_fundo_reserva,
                  (r.valor + COALESCE(r.valor_fundo_reserva, 0)) AS valor_total,
                  r.data_vencimento, r.id_unidade, r.id_usuario,
                  (CURRENT_DATE - r.data_vencimento) AS dias_atraso,
                  un.unidades_bloco AS unidade,
                  us.bloco
             FROM "condominio-bh".tb_fin_receitas r
             LEFT JOIN "condominio-bh".tb_condominios_unidades un ON un.id = r.id_unidade AND un.id_condominio = r.id_condominio
             LEFT JOIN (
               SELECT DISTINCT ON (id_condominio, apartamento) *
                 FROM "condominio-bh"."tb-usuarios"
                WHERE status = 'ativo'
                ORDER BY id_condominio, apartamento, id
             ) us ON us.id_condominio = un.id_condominio AND us.apartamento = un.unidades_bloco
            WHERE r.id_condominio = :id_condominio
              AND r.situacao = 'em_aberto'
              AND r.data_vencimento < CURRENT_DATE
            ORDER BY (CURRENT_DATE - r.data_vencimento) DESC
            LIMIT 5`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT
              TO_CHAR(meses.mes, 'YYYY-MM') AS mes,
              COALESCE(r.total_receitas, 0)::numeric AS total_receitas,
              COALESCE(r.total_recebido, 0)::numeric AS total_recebido,
              COALESCE(d.total_despesas, 0)::numeric AS total_despesas,
              COALESCE(d.total_pago, 0)::numeric AS total_pago
             FROM generate_series(
                    DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
                    DATE_TRUNC('month', CURRENT_DATE),
                    INTERVAL '1 month'
                  ) AS meses(mes)
             LEFT JOIN (
                 SELECT DATE_TRUNC('month', competencia) AS mes,
                        SUM(CASE WHEN situacao != 'cancelado' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END) AS total_receitas,
                        SUM(CASE WHEN situacao = 'pago' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END) AS total_recebido
                   FROM "condominio-bh".tb_fin_receitas
                  WHERE id_condominio = :id_condominio
                  GROUP BY DATE_TRUNC('month', competencia)
             ) r ON r.mes = meses.mes
             LEFT JOIN (
                 SELECT DATE_TRUNC('month', competencia) AS mes,
                        SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END) AS total_despesas,
                        SUM(CASE WHEN situacao = 'pago' THEN valor ELSE 0 END) AS total_pago
                   FROM "condominio-bh".tb_fin_despesas
                  WHERE id_condominio = :id_condominio
                  GROUP BY DATE_TRUNC('month', competencia)
             ) d ON d.mes = meses.mes
            ORDER BY meses.mes`,
          { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT g.codigo AS categoria,
                  g.nome AS grupo_despesa_nome,
                  g.descricao AS grupo_despesa_descricao,
                  COALESCE(SUM(d.valor), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas d
            LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
            WHERE d.id_condominio = :id_condominio
              AND TO_CHAR(d.competencia, 'YYYY-MM') = :periodo
              AND d.situacao != 'cancelado'
            GROUP BY g.codigo, g.nome, g.descricao
            ORDER BY total DESC`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
      ]);

      const kr = kpisReceitas[0] || {};
      const kd = kpisDespesas[0] || {};

      return res.status(200).json({
        periodo,
        kpis: {
          total_receitas: Number(kr.total_receitas || 0),
          total_recebido: Number(kr.total_recebido || 0),
          total_inadimplente: Number(kr.total_inadimplente || 0),
          total_despesas: Number(kd.total_despesas || 0),
          total_pago: Number(kd.total_pago || 0),
          saldo: Number(kr.total_recebido || 0) - Number(kd.total_pago || 0),
        },
        ultimas_despesas: ultimasDespesas,
        top_inadimplentes: topInadimplentes,
        grafico_6meses: grafico,
        distribuicao_despesas: distribuicaoDespesas.map((item) => ({
          ...item,
          total: Number(item.total || 0),
        })),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao carregar dashboard.', detail: error.message });
    }
  }

  async getOrcamentoDashboard(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const periodo = this._periodoDaQuery(req) || this._periodoAtual();
      const rpl = { id_condominio: idCondominio, periodo };

      const [previstoReceitas, previstoDespesas, realizadoReceitas, realizadoDespesas] = await Promise.all([
        postgres.query(
          `SELECT COALESCE(AVG(total_mes), 0)::numeric AS media, COUNT(*)::int AS meses_base
             FROM (
               SELECT DATE_TRUNC('month', competencia) AS mes,
                      SUM(CASE WHEN situacao != 'cancelado' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END) AS total_mes
                 FROM "condominio-bh".tb_fin_receitas
                WHERE id_condominio = :id_condominio
                  AND competencia >= TO_DATE(:periodo, 'YYYY-MM') - INTERVAL '12 months'
                  AND competencia < TO_DATE(:periodo, 'YYYY-MM')
                GROUP BY DATE_TRUNC('month', competencia)
             ) t`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(AVG(total_mes), 0)::numeric AS media, COUNT(*)::int AS meses_base
             FROM (
               SELECT DATE_TRUNC('month', competencia) AS mes,
                      SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END) AS total_mes
                 FROM "condominio-bh".tb_fin_despesas
                WHERE id_condominio = :id_condominio
                  AND competencia >= TO_DATE(:periodo, 'YYYY-MM') - INTERVAL '12 months'
                  AND competencia < TO_DATE(:periodo, 'YYYY-MM')
                GROUP BY DATE_TRUNC('month', competencia)
             ) t`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
      ]);

      const receitasPrevisto = Number(previstoReceitas[0]?.media || 0);
      const despesasPrevisto = Number(previstoDespesas[0]?.media || 0);
      const receitasRealizado = Number(realizadoReceitas[0]?.total || 0);
      const despesasRealizado = Number(realizadoDespesas[0]?.total || 0);
      const mesesBaseCalculo = Math.min(
        Number(previstoReceitas[0]?.meses_base || 0),
        Number(previstoDespesas[0]?.meses_base || 0)
      );

      return res.status(200).json({
        periodo,
        orcamento: {
          total_receitas_previsto: receitasPrevisto,
          total_despesas_previsto: despesasPrevisto,
          total_receitas_realizado: receitasRealizado,
          total_despesas_realizado: despesasRealizado,
          percentual_realizado_receitas: receitasPrevisto > 0 ? (receitasRealizado / receitasPrevisto) * 100 : 0,
          percentual_realizado_despesas: despesasPrevisto > 0 ? (despesasRealizado / despesasPrevisto) * 100 : 0,
          meses_base_calculo: mesesBaseCalculo,
        },
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao carregar orçamento.', detail: error.message });
    }
  }

  async getFundoReserva(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const [metaRows, arrecadadoRows] = await Promise.all([
        postgres.query(
          `SELECT valor_meta
             FROM "condominio-bh".tb_fin_meta_fundo_reserva
            WHERE id_condominio = :id_condominio`,
          { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS arrecadado
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio`,
          { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
        ),
      ]);

      const valorMeta = metaRows[0]?.valor_meta !== undefined ? Number(metaRows[0].valor_meta) : null;
      const valorArrecadado = Number(arrecadadoRows[0]?.arrecadado || 0);

      return res.status(200).json({
        valor_meta: valorMeta,
        valor_arrecadado: valorArrecadado,
        percentual_atingido: valorMeta ? (valorArrecadado / valorMeta) * 100 : 0,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao carregar fundo de reserva.', detail: error.message });
    }
  }

  async atualizarMetaFundoReserva(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!['Admin', 'Sindico'].includes(req.nomePerfil)) return res.status(403).json({ message: 'Apenas Admin ou Síndico podem atualizar a meta do fundo de reserva.' });

      const valorMeta = this._parseDecimalOuNull(req.body.valor_meta);
      if (valorMeta === null || valorMeta < 0) return res.status(422).json({ message: 'valor_meta é obrigatório e deve ser um número maior ou igual a zero.' });

      const idUsuario = this._toInt(req.idcliente, null);

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_meta_fundo_reserva (id_condominio, valor_meta, atualizado_por, created_at, updated_at)
         VALUES (:id_condominio, :valor_meta, :atualizado_por, NOW(), NOW())
         ON CONFLICT (id_condominio) DO UPDATE
           SET valor_meta = :valor_meta, atualizado_por = :atualizado_por, updated_at = NOW()`,
        { replacements: { id_condominio: idCondominio, valor_meta: valorMeta, atualizado_por: idUsuario } }
      );

      return res.status(200).json({ message: 'Meta do fundo de reserva atualizada.', valor_meta: valorMeta });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar meta do fundo de reserva.', detail: error.message });
    }
  }

  async getScoreFinanceiro(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const periodo = this._periodoDaQuery(req) || this._periodoAtual();
      const rpl = { id_condominio: idCondominio, periodo };

      const [kpisReceitas, kpisDespesas, saldoRows, despesasVencidasRows, metaRows, arrecadadoRows, pagamentosRows] = await Promise.all([
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total_receitas,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total_recebido,
              COALESCE(SUM(CASE WHEN situacao = 'em_aberto' AND data_vencimento < CURRENT_DATE THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS total_inadimplente
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END), 0)::numeric AS total_despesas,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor ELSE 0 END), 0)::numeric AS total_pago,
              COUNT(CASE WHEN situacao != 'cancelado' THEN 1 END)::int AS qtd_total,
              COUNT(CASE WHEN situacao = 'pago' AND data_pagamento <= data_despesa THEN 1 END)::int AS qtd_pagas_no_prazo
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS recebido_acumulado,
              (SELECT COALESCE(SUM(valor), 0) FROM "condominio-bh".tb_fin_despesas
                WHERE id_condominio = :id_condominio AND situacao = 'pago'
                  AND COALESCE(data_pagamento, data_despesa) < (TO_DATE(:periodo, 'YYYY-MM') + INTERVAL '1 month'))::numeric AS pago_acumulado
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND COALESCE(data_pagamento, competencia) < (TO_DATE(:periodo, 'YYYY-MM') + INTERVAL '1 month')`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(valor), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND situacao = 'a_pagar'
              AND data_despesa < CURRENT_DATE`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT valor_meta
             FROM "condominio-bh".tb_fin_meta_fundo_reserva
            WHERE id_condominio = :id_condominio`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS arrecadado
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COUNT(*)::int AS qtd_total,
                  COUNT(CASE WHEN situacao = 'pago' AND data_pagamento <= data_despesa THEN 1 END)::int AS qtd_pagas_no_prazo
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND situacao != 'cancelado'
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
      ]);

      const kr = kpisReceitas[0] || {};
      const kd = kpisDespesas[0] || {};
      const totalReceitas = Number(kr.total_receitas || 0);
      const totalRecebido = Number(kr.total_recebido || 0);
      const totalInadimplente = Number(kr.total_inadimplente || 0);
      const totalDespesas = Number(kd.total_despesas || 0);
      const totalPago = Number(kd.total_pago || 0);

      const saldoCaixa = Number(saldoRows[0]?.recebido_acumulado || 0) - Number(saldoRows[0]?.pago_acumulado || 0);
      const despesasVencidas = Number(despesasVencidasRows[0]?.total || 0);
      const valorMeta = metaRows[0]?.valor_meta !== undefined && metaRows[0]?.valor_meta !== null ? Number(metaRows[0].valor_meta) : null;
      const valorArrecadado = Number(arrecadadoRows[0]?.arrecadado || 0);
      const percentualMeta = valorMeta ? (valorArrecadado / valorMeta) * 100 : 0;
      const qtdTotalPagamentos = Number(pagamentosRows[0]?.qtd_total || 0);
      const qtdPagasNoPrazo = Number(pagamentosRows[0]?.qtd_pagas_no_prazo || 0);

      const mesesCobertura = totalDespesas > 0 ? saldoCaixa / totalDespesas : 5;
      const liquidez = Math.max(0, Math.min(10, mesesCobertura * 2));
      const endividamento = 10 - Math.max(0, Math.min(10, totalReceitas > 0 ? (despesasVencidas / totalReceitas) * 10 : 0));
      const inadimplencia = 10 - Math.max(0, Math.min(10, totalReceitas > 0 ? (totalInadimplente / totalReceitas) * 10 : 0));
      const fundoReserva = Math.max(0, Math.min(10, percentualMeta / 10));
      const receitaDespesa = totalPago > 0 ? Math.max(0, Math.min(10, (totalRecebido / totalPago) * 5)) : 10;
      const pagamentosEmDia = qtdTotalPagamentos > 0 ? (qtdPagasNoPrazo / qtdTotalPagamentos) * 10 : 10;

      const subIndicadores = {
        liquidez,
        endividamento,
        inadimplencia,
        fundo_reserva: fundoReserva,
        receita_despesa: receitaDespesa,
        pagamentos_em_dia: pagamentosEmDia,
      };
      const valores = Object.values(subIndicadores);
      const notaGeral = valores.reduce((acc, v) => acc + v, 0) / valores.length;

      return res.status(200).json({
        periodo,
        nota_geral: notaGeral,
        sub_indicadores: subIndicadores,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao calcular score financeiro.', detail: error.message });
    }
  }

  async getInadimplenciaSerie(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const meses = Math.min(Math.max(this._toInt(req.query.meses, 12), 1), 24);

      const serie = await postgres.query(
        `SELECT
            TO_CHAR(meses.mes, 'YYYY-MM') AS mes,
            COALESCE(SUM(r.valor + COALESCE(r.valor_fundo_reserva, 0)), 0)::numeric AS total_inadimplente,
            COUNT(DISTINCT r.id_unidade)::int AS qtd_unidades
           FROM generate_series(
                  DATE_TRUNC('month', CURRENT_DATE) - (:meses || ' months')::interval,
                  DATE_TRUNC('month', CURRENT_DATE),
                  INTERVAL '1 month'
                ) AS meses(mes)
           LEFT JOIN "condominio-bh".tb_fin_receitas r
             ON r.id_condominio = :id_condominio
            AND r.situacao = 'em_aberto'
            AND r.data_vencimento < (meses.mes + INTERVAL '1 month')
            AND r.data_vencimento < CURRENT_DATE
          GROUP BY meses.mes
          ORDER BY meses.mes`,
        { replacements: { id_condominio: idCondominio, meses }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({
        serie: serie.map((item) => ({
          mes: item.mes,
          total_inadimplente: Number(item.total_inadimplente || 0),
          qtd_unidades: Number(item.qtd_unidades || 0),
        })),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao carregar série histórica de inadimplência.', detail: error.message });
    }
  }

  async getConsumoUtilidades(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const periodo = this._periodoDaQuery(req) || this._periodoAtual();
      const meses = Math.min(Math.max(this._toInt(req.query.meses, 6), 1), 24);
      const rpl = { id_condominio: idCondominio, periodo, meses };

      const [totais, serieHistorica] = await Promise.all([
        postgres.query(
          `SELECT g.codigo AS categoria, g.nome AS grupo_despesa_nome,
                  COALESCE(SUM(d.valor), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas d
             LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
            WHERE d.id_condominio = :id_condominio
              AND d.categoria IN ('UT001', 'UT002')
              AND TO_CHAR(d.competencia, 'YYYY-MM') = :periodo
              AND d.situacao != 'cancelado'
            GROUP BY g.codigo, g.nome
            ORDER BY g.codigo`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT TO_CHAR(meses.mes, 'YYYY-MM') AS mes, cat.categoria,
                  COALESCE(d.total, 0)::numeric AS total
             FROM generate_series(
                    DATE_TRUNC('month', CURRENT_DATE) - (:meses || ' months')::interval,
                    DATE_TRUNC('month', CURRENT_DATE),
                    INTERVAL '1 month'
                  ) AS meses(mes)
             CROSS JOIN (VALUES ('UT001'), ('UT002')) AS cat(categoria)
             LEFT JOIN (
               SELECT DATE_TRUNC('month', competencia) AS mes, categoria,
                      SUM(valor) AS total
                 FROM "condominio-bh".tb_fin_despesas
                WHERE id_condominio = :id_condominio
                  AND categoria IN ('UT001', 'UT002')
                  AND situacao != 'cancelado'
                GROUP BY DATE_TRUNC('month', competencia), categoria
             ) d ON d.mes = meses.mes AND d.categoria = cat.categoria
            ORDER BY meses.mes, cat.categoria`,
          { replacements: rpl, type: QueryTypes.SELECT }
        ),
      ]);

      return res.status(200).json({
        periodo,
        tem_dados_periodo: totais.length > 0,
        totais: totais.map((item) => ({ ...item, total: Number(item.total || 0) })),
        serie_historica: serieHistorica.map((item) => ({ ...item, total: Number(item.total || 0) })),
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao carregar consumo de utilidades.', detail: error.message });
    }
  }

  async listarLancamentosRecentes(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const limit = Math.min(Math.max(this._toInt(req.query.limit, 10), 1), 50);

      const data = await postgres.query(
        `SELECT * FROM (
             SELECT 'receita' AS tipo, r.id, r.descricao, r.categoria, r.valor, r.valor_fundo_reserva,
                    (r.valor + COALESCE(r.valor_fundo_reserva, 0)) AS valor_total, r.situacao,
                    COALESCE(r.data_pagamento, r.data_vencimento) AS data_evento,
                    us.nome AS usuario_nome, us.bloco, us.apartamento
               FROM "condominio-bh".tb_fin_receitas r
               LEFT JOIN "condominio-bh".tb_condominios_unidades tcu
                 ON tcu.id = r.id_unidade AND tcu.id_condominio = r.id_condominio
               LEFT JOIN (
                 SELECT DISTINCT ON (id_condominio, apartamento) *
                   FROM "condominio-bh"."tb-usuarios"
                  WHERE status = 'ativo'
                  ORDER BY id_condominio, apartamento, id
               ) us ON us.id_condominio = tcu.id_condominio AND us.apartamento = tcu.unidades_bloco
              WHERE r.id_condominio = :id_condominio AND r.situacao != 'cancelado'
              UNION ALL
             SELECT 'despesa' AS tipo, d.id, d.descricao, d.categoria, d.valor, NULL::numeric AS valor_fundo_reserva,
                    d.valor AS valor_total, d.situacao,
                    COALESCE(d.data_pagamento, d.data_despesa) AS data_evento,
                    d.fornecedor AS usuario_nome, NULL::varchar AS bloco, NULL::varchar AS apartamento
               FROM "condominio-bh".tb_fin_despesas d
              WHERE d.id_condominio = :id_condominio AND d.situacao != 'cancelado'
           ) lancamentos
          ORDER BY data_evento DESC, id DESC
          LIMIT :limit`,
        { replacements: { id_condominio: idCondominio, limit }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar lançamentos recentes.', detail: error.message });
    }
  }

  // ─── Inadimplência ──────────────────────────────────────────────────────────

  async listarInadimplencia(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      if (String(req.query.resumo) === '1') {
        const rows = await postgres.query(
          `SELECT
              COALESCE(SUM(r.valor + COALESCE(r.valor_fundo_reserva, 0)), 0)::numeric AS total_valor,
              COUNT(DISTINCT r.id_unidade)::int AS total_unidades,
              COUNT(*)::int AS total_pendencias
             FROM "condominio-bh".tb_fin_receitas r
            WHERE r.id_condominio = :id_condominio
              AND r.situacao = 'em_aberto'
              AND r.data_vencimento < CURRENT_DATE`,
          { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
        );
        const resumo = rows[0] || {};
        return res.status(200).json({
          total_valor: Number(resumo.total_valor || 0),
          total_unidades: Number(resumo.total_unidades || 0),
          total_pendencias: Number(resumo.total_pendencias || 0),
        });
      }

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;
      const replacements = { id_condominio: idCondominio, limit: pageSize, offset };

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total
             FROM "condominio-bh".tb_fin_receitas r
             LEFT JOIN "condominio-bh".tb_condominios_unidades un ON un.id = r.id_unidade AND un.id_condominio = r.id_condominio
             LEFT JOIN (
               SELECT DISTINCT ON (id_condominio, apartamento) *
                 FROM "condominio-bh"."tb-usuarios"
                WHERE status = 'ativo'
                ORDER BY id_condominio, apartamento, id
             ) us ON us.id_condominio = un.id_condominio AND us.apartamento = un.unidades_bloco
            WHERE r.id_condominio = :id_condominio
              AND r.situacao = 'em_aberto'
              AND r.data_vencimento < CURRENT_DATE`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT r.id, r.descricao, r.categoria, r.valor, r.valor_fundo_reserva,
                  (r.valor + COALESCE(r.valor_fundo_reserva, 0)) AS valor_total,
                  r.data_vencimento, r.competencia,
                  r.id_unidade, r.id_usuario, r.grupo_receita AS tipo_pendencia,
                  (CURRENT_DATE - r.data_vencimento) AS dias_atraso,
                  i.juros, i.multa, i.valor_atualizado,
                  un.unidades_bloco,
                  us.nome,
                  us.bloco,
                  us.email
             FROM "condominio-bh".tb_fin_receitas r
             LEFT JOIN "condominio-bh".tb_fin_inadimplencia i ON i.id_receita = r.id
             LEFT JOIN "condominio-bh".tb_condominios_unidades un ON un.id = r.id_unidade AND un.id_condominio = r.id_condominio
             LEFT JOIN (
               SELECT DISTINCT ON (id_condominio, apartamento) *
                 FROM "condominio-bh"."tb-usuarios"
                WHERE status = 'ativo'
                ORDER BY id_condominio, apartamento, id
             ) us ON us.id_condominio = un.id_condominio AND us.apartamento = un.unidades_bloco
            WHERE r.id_condominio = :id_condominio
              AND r.situacao = 'em_aberto'
              AND r.data_vencimento < CURRENT_DATE
            ORDER BY (CURRENT_DATE - r.data_vencimento) DESC
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const total = totalRows[0]?.total || 0;
      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        data,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar inadimplência.', detail: error.message });
    }
  }

  async cobrarInadimplente(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const idReceita = this._toInt(req.params.id, null);
      const idSolicitante = this._toInt(req.idcliente, null);

      const outrasPendenciasIds = Array.isArray(req.body.outras_pendencias_ids)
        ? [...new Set(
            req.body.outras_pendencias_ids
              .map((valor) => this._toInt(valor, null))
              .filter((valor) => valor && valor !== idReceita)
          )]
        : [];
      const anexosUrls = Array.isArray(req.body.anexos_urls)
        ? req.body.anexos_urls.map((valor) => String(valor).trim()).filter(Boolean)
        : [];
      const observacao = this._normalizarTextoOuNull(req.body.observacao);

      const idsConsulta = [idReceita, ...outrasPendenciasIds];

      const receitasEncontradas = await postgres.query(
        `SELECT r.id, r.id_unidade, r.descricao, r.valor, r.valor_fundo_reserva, r.data_vencimento, r.id_usuario,
                u.nome AS usuario_nome, u.email AS usuario_email,
                c.nome AS condominio_nome,
                (CURRENT_DATE - r.data_vencimento) AS dias_atraso
           FROM "condominio-bh".tb_fin_receitas r
           LEFT JOIN "condominio-bh".tb_condominios_unidades tcu
             ON tcu.id = r.id_unidade AND tcu.id_condominio = r.id_condominio
           LEFT JOIN (
             SELECT DISTINCT ON (id_condominio, apartamento) *
               FROM "condominio-bh"."tb-usuarios"
              WHERE status = 'ativo'
              ORDER BY id_condominio, apartamento, id
           ) u ON u.id_condominio = tcu.id_condominio AND u.apartamento = tcu.unidades_bloco
           LEFT JOIN "condominio-bh"."tb-condominios" c ON c.id::text = r.id_condominio::text
          WHERE r.id IN (:ids) AND r.id_condominio = :id_condominio AND r.situacao = 'em_aberto'`,
        { replacements: { ids: idsConsulta, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      const porId = new Map(receitasEncontradas.map((r) => [this._toInt(r.id, null), r]));
      const receitaPrincipal = porId.get(idReceita);
      if (!receitaPrincipal) return res.status(404).json({ message: 'Receita inadimplente não encontrada.' });

      if (outrasPendenciasIds.length > 0) {
        const naoEncontrados = outrasPendenciasIds.filter((id) => !porId.has(id));
        if (naoEncontrados.length > 0) {
          return res.status(422).json({
            message: `Pendência(s) não encontrada(s) ou não está(ão) em aberto: ${naoEncontrados.join(', ')}`,
          });
        }

        const idUnidadePrincipal = this._toInt(receitaPrincipal.id_unidade, null);
        if (!idUnidadePrincipal) {
          return res.status(422).json({ message: 'A pendência principal não tem unidade vinculada — não é possível consolidar.' });
        }

        const divergentes = outrasPendenciasIds.filter(
          (id) => this._toInt(porId.get(id).id_unidade, null) !== idUnidadePrincipal
        );
        if (divergentes.length > 0) {
          return res.status(422).json({
            message: `Pendência(s) de outra unidade, consolidação não permitida: ${divergentes.join(', ')}`,
          });
        }
      }

      const pendencias = idsConsulta.map((id) => porId.get(id));
      const consolidado = outrasPendenciasIds.length > 0;

      res.status(200).json({
        message: 'Cobrança disparada.',
        ...(consolidado ? { pendencias_incluidas: idsConsulta } : {}),
      });

      setImmediate(async () => {
        for (const pendencia of pendencias) {
          if (!pendencia.id_usuario) continue;

          const mensagemIndividual = `Você possui débito pendente: ${pendencia.descricao} — vencido em ${pendencia.data_vencimento}.`;
          try {
            await pushNotificationService.enviarParaUsuarios([pendencia.id_usuario], {
              title: 'Aviso de Inadimplência',
              body: mensagemIndividual,
              data: { tipo: 'financeiro', id_receita: pendencia.id },
            });
            await postgres.query(
              `INSERT INTO "condominio-bh".tb_fin_cobranca_log
                  (id_condominio, id_receita, id_usuario, id_usuario_solicitante, canal, mensagem, observacao, enviou_anexo)
                 VALUES (:id_condominio, :id_receita, :id_usuario, :id_usuario_solicitante, 'push', :mensagem, :observacao, false)`,
              {
                replacements: {
                  id_condominio: idCondominio,
                  id_receita: pendencia.id,
                  id_usuario: this._toInt(pendencia.id_usuario, null),
                  id_usuario_solicitante: idSolicitante,
                  mensagem: mensagemIndividual,
                  observacao,
                },
              }
            );
          } catch (pushErr) {
            console.error(`[cobrarInadimplente] Erro no push (receita ${pendencia.id}):`, pushErr?.message);
          }
        }

        const emails = [...new Set(pendencias.map((p) => p.usuario_email).filter(Boolean))];
        if (emails.length > 0) {
          try {
            const valorTotal = pendencias.reduce((soma, p) => soma + Number(p.valor || 0) + Number(p.valor_fundo_reserva || 0), 0);
            const diasAtrasoMax = Math.max(...pendencias.map((p) => Number(p.dias_atraso || 0)));

            const mensagemCobranca = consolidado
              ? `Você possui ${pendencias.length} débitos pendentes na sua unidade, totalizando R$ ${valorTotal.toFixed(2)}.`
              : `Você possui débito pendente: ${receitaPrincipal.descricao} — vencido em ${receitaPrincipal.data_vencimento}.`;

            const boletosParaEmail = anexosUrls.map(
              (url) => `${this._publicApiBaseUrl()}/api/condominio/financeiro/boletos/download?url=${encodeURIComponent(url)}`
            );

            const details = {};
            if (observacao) details['Observação'] = observacao;
            if (boletosParaEmail.length > 0) details['Boletos'] = boletosParaEmail.join('\n');
            if (consolidado) {
              details['Pendências consolidadas'] = pendencias
                .map((p) => `${p.descricao} — R$ ${(Number(p.valor || 0) + Number(p.valor_fundo_reserva || 0)).toFixed(2)} — venceu ${p.data_vencimento}`)
                .join('\n');
            }

            await despacharEmail({
              _ref: `cobranca_${idCondominio}_${idsConsulta.join('-')}`,
              template: 'cobranca_inadimplente',
              emails,
              cobranca: {
                nome: receitaPrincipal.usuario_nome || '',
                descricao: consolidado ? `${pendencias.length} pendências consolidadas` : (receitaPrincipal.descricao || ''),
                valor: valorTotal,
                data_vencimento: receitaPrincipal.data_vencimento,
                dias_atraso: diasAtrasoMax,
                condominio_nome: receitaPrincipal.condominio_nome || '',
              },
              ...(Object.keys(details).length > 0 ? { details } : {}),
              ...(boletosParaEmail.length > 0 ? { link: boletosParaEmail[0] } : {}),
            });

            for (const pendencia of pendencias) {
              await postgres.query(
                `INSERT INTO "condominio-bh".tb_fin_cobranca_log
                    (id_condominio, id_receita, id_usuario, id_usuario_solicitante, canal, mensagem, observacao, enviou_anexo, path_anexo)
                   VALUES (:id_condominio, :id_receita, :id_usuario, :id_usuario_solicitante, 'email', :mensagem, :observacao, :enviou_anexo, :path_anexo)`,
                {
                  replacements: {
                    id_condominio: idCondominio,
                    id_receita: pendencia.id,
                    id_usuario: this._toInt(pendencia.id_usuario, null),
                    id_usuario_solicitante: idSolicitante,
                    mensagem: mensagemCobranca,
                    observacao,
                    enviou_anexo: anexosUrls.length > 0,
                    path_anexo: anexosUrls.length > 0 ? anexosUrls.join('\n') : null,
                  },
                }
              );
            }
          } catch (emailErr) {
            console.error('[cobrarInadimplente] Erro no e-mail:', emailErr?.message);
          }
        }
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao processar cobrança.', detail: error.message });
    }
  }

  // ─── Cobrança (log) ──────────────────────────────────────────────────────────

  async listarCobrancaLog(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const whereParts = ['cl.id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio, limit: pageSize, offset };

      const idReceitaFiltro = this._toInt(req.query.id_receita, null);
      if (idReceitaFiltro) {
        whereParts.push('cl.id_receita = :id_receita');
        replacements.id_receita = idReceitaFiltro;
      }

      const idUsuarioFiltro = this._toInt(req.query.id_usuario, null);
      if (idUsuarioFiltro) {
        whereParts.push('cl.id_usuario = :id_usuario');
        replacements.id_usuario = idUsuarioFiltro;
      }

      if (req.query.canal) {
        whereParts.push('cl.canal = :canal');
        replacements.canal = req.query.canal;
      }

      if (req.query.data_inicio) {
        whereParts.push('cl.created_at >= :data_inicio');
        replacements.data_inicio = req.query.data_inicio;
      }
      if (req.query.data_fim) {
        whereParts.push('cl.created_at <= :data_fim');
        replacements.data_fim = req.query.data_fim;
      }

      const whereClause = whereParts.join(' AND ');

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total FROM "condominio-bh".tb_fin_cobranca_log cl WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT cl.id, cl.id_receita, cl.canal, cl.mensagem, cl.created_at,
                  cl.observacao, cl.enviou_anexo, cl.path_anexo,
                  cl.id_usuario, u.nome AS usuario_nome,
                  cl.id_usuario_solicitante, us.nome AS solicitante_nome,
                  r.descricao AS receita_descricao, r.valor AS receita_valor, r.valor_fundo_reserva AS receita_valor_fundo_reserva,
                  (r.valor + COALESCE(r.valor_fundo_reserva, 0)) AS receita_valor_total
             FROM "condominio-bh".tb_fin_cobranca_log cl
             LEFT JOIN "condominio-bh"."tb-usuarios" u ON u.id = cl.id_usuario
             LEFT JOIN "condominio-bh"."tb-usuarios" us ON us.id = cl.id_usuario_solicitante
             LEFT JOIN "condominio-bh".tb_fin_receitas r ON r.id = cl.id_receita
            WHERE ${whereClause}
            ORDER BY cl.created_at DESC
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const total = totalRows[0]?.total || 0;
      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        data,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar cobranças.', detail: error.message });
    }
  }

  // ─── Balancete ───────────────────────────────────────────────────────────────

  async getBalancete(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });

      const periodo = this._periodoDaQuery(req) || this._periodoAtual();
      const ano = periodo.slice(0, 4);
      const replacements = { id_condominio: idCondominio, periodo, ano };

      // Moradores só veem balancetes publicados
      if (!this._isGestor(req)) {
        const publicado = await postgres.query(
          `SELECT 1
             FROM "condominio-bh".tb_fin_balancetes
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
              AND publicado = true`,
          { replacements, type: QueryTypes.SELECT }
        );
        if (!publicado[0]) return res.status(404).json({ message: 'Balancete não publicado para este período.' });
      }

      const [recebidoAcumulado, pagoAcumulado, recebidoAcumuladoAnterior, pagoAcumuladoAnterior, receitasAno, despesasAno, balancete, receitas, despesas, ultimaAlteracaoRows] = await Promise.all([
        postgres.query(
          `SELECT COALESCE(SUM(valor + COALESCE(valor_fundo_reserva, 0)), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND situacao = 'pago'
              AND COALESCE(data_pagamento, competencia) < (TO_DATE(:periodo, 'YYYY-MM') + INTERVAL '1 month')`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(valor), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND situacao = 'pago'
              AND COALESCE(data_pagamento, data_despesa) < (TO_DATE(:periodo, 'YYYY-MM') + INTERVAL '1 month')`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(valor + COALESCE(valor_fundo_reserva, 0)), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND situacao = 'pago'
              AND COALESCE(data_pagamento, competencia) < TO_DATE(:periodo, 'YYYY-MM')`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(valor), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND situacao = 'pago'
              AND COALESCE(data_pagamento, data_despesa) < TO_DATE(:periodo, 'YYYY-MM')`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END), 0)::numeric AS total,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor ELSE 0 END), 0)::numeric AS pago,
              COALESCE(SUM(CASE WHEN situacao = 'em_aberto' THEN valor ELSE 0 END), 0)::numeric AS pendente,
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS fundo_reserva_total,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS fundo_reserva_pago,
              COALESCE(SUM(CASE WHEN situacao = 'em_aberto' THEN valor_fundo_reserva ELSE 0 END), 0)::numeric AS fundo_reserva_pendente,
              COALESCE(SUM(CASE WHEN situacao = 'em_aberto' AND data_vencimento < CURRENT_DATE THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS inadimplente,
              COALESCE(SUM(CASE WHEN situacao = 'em_aberto' AND data_vencimento >= CURRENT_DATE THEN valor + COALESCE(valor_fundo_reserva, 0) ELSE 0 END), 0)::numeric AS a_receber_no_prazo
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND EXTRACT(YEAR FROM competencia) = :ano`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT
              COALESCE(SUM(CASE WHEN situacao != 'cancelado' THEN valor ELSE 0 END), 0)::numeric AS total,
              COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor ELSE 0 END), 0)::numeric AS pago,
              COALESCE(SUM(CASE WHEN situacao = 'a_pagar' THEN valor ELSE 0 END), 0)::numeric AS pendente
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND EXTRACT(YEAR FROM competencia) = :ano`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT b.*, u.nome AS publicado_por_nome
             FROM "condominio-bh".tb_fin_balancetes b
             LEFT JOIN "condominio-bh"."tb-usuarios" u ON u.id = b.publicado_por
            WHERE b.id_condominio = :id_condominio AND TO_CHAR(b.competencia, 'YYYY-MM') = :periodo`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT r.id, r.categoria, r.descricao, r.valor, r.valor_fundo_reserva,
                  (r.valor + COALESCE(r.valor_fundo_reserva, 0)) AS valor_total,
                  r.competencia, r.data_vencimento, r.data_pagamento, r.situacao, r.id_unidade,
                  g.nome AS grupo_receita_nome
             FROM "condominio-bh".tb_fin_receitas r
             LEFT JOIN "condominio-bh".tb_fin_grupo_receita g ON g.id = r.id_grupo_receita
            WHERE r.id_condominio = :id_condominio
              AND r.situacao != 'cancelado'
              AND (
                   (r.situacao = 'pago' AND TO_CHAR(r.data_pagamento, 'YYYY-MM') = :periodo)
                OR (r.situacao = 'em_aberto' AND TO_CHAR(r.competencia, 'YYYY-MM') = :periodo)
              )
            ORDER BY r.data_vencimento`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT d.id, d.categoria, d.descricao, d.valor, d.data_despesa, d.data_pagamento, d.situacao, d.fornecedor,
                  g.nome AS grupo_despesa_nome,
                  g.descricao AS grupo_despesa_descricao
             FROM "condominio-bh".tb_fin_despesas d
            LEFT JOIN "condominio-bh".tb_fin_grupo_despesa g ON g.codigo = d.categoria
            WHERE d.id_condominio = :id_condominio
              AND d.situacao != 'cancelado'
              AND (
                   (d.situacao = 'pago' AND TO_CHAR(d.data_pagamento, 'YYYY-MM') = :periodo)
                OR (d.situacao = 'a_pagar' AND TO_CHAR(d.competencia, 'YYYY-MM') = :periodo)
              )
            ORDER BY d.data_despesa`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT MAX(updated_at) AS ultima_alteracao
             FROM (
               SELECT updated_at FROM "condominio-bh".tb_fin_receitas WHERE id_condominio = :id_condominio AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
               UNION ALL
               SELECT updated_at FROM "condominio-bh".tb_fin_despesas WHERE id_condominio = :id_condominio AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
             ) t`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const totalRecebidoAcumulado = Number(recebidoAcumulado[0]?.total || 0);
      const totalPagoAcumulado = Number(pagoAcumulado[0]?.total || 0);
      const totalRecebidoAcumuladoAnterior = Number(recebidoAcumuladoAnterior[0]?.total || 0);
      const totalPagoAcumuladoAnterior = Number(pagoAcumuladoAnterior[0]?.total || 0);
      const saldoCaixaMesAnterior = totalRecebidoAcumuladoAnterior - totalPagoAcumuladoAnterior;

      const balanceteRow = balancete[0] || null;
      const ultimaAlteracao = ultimaAlteracaoRows[0]?.ultima_alteracao || null;
      const balanceteComFlag = balanceteRow
        ? {
            ...balanceteRow,
            ultima_alteracao_em: ultimaAlteracao,
            alterado_apos_publicacao: Boolean(
              balanceteRow.publicado &&
                ultimaAlteracao &&
                balanceteRow.publicado_em &&
                new Date(ultimaAlteracao) > new Date(balanceteRow.publicado_em)
            ),
          }
        : null;

      return res.status(200).json({
        periodo,
        saldo_caixa: totalRecebidoAcumulado - totalPagoAcumulado,
        saldo_caixa_mes_anterior: saldoCaixaMesAnterior,
        balancete: balanceteComFlag,
        receitas,
        despesas,
        totais_ano: {
          ano,
          receitas: {
            total: Number(receitasAno[0]?.total || 0),
            pago: Number(receitasAno[0]?.pago || 0),
            pendente: Number(receitasAno[0]?.pendente || 0),
            fundo_reserva: {
              total: Number(receitasAno[0]?.fundo_reserva_total || 0),
              pago: Number(receitasAno[0]?.fundo_reserva_pago || 0),
              pendente: Number(receitasAno[0]?.fundo_reserva_pendente || 0),
            },
            total_com_fundo_reserva: Number(receitasAno[0]?.total || 0) + Number(receitasAno[0]?.fundo_reserva_total || 0),
            pago_com_fundo_reserva: Number(receitasAno[0]?.pago || 0) + Number(receitasAno[0]?.fundo_reserva_pago || 0),
            pendente_com_fundo_reserva: Number(receitasAno[0]?.pendente || 0) + Number(receitasAno[0]?.fundo_reserva_pendente || 0),
            em_aberto: {
              total: Number(receitasAno[0]?.pendente || 0) + Number(receitasAno[0]?.fundo_reserva_pendente || 0),
              inadimplente: Number(receitasAno[0]?.inadimplente || 0),
              a_receber_no_prazo: Number(receitasAno[0]?.a_receber_no_prazo || 0),
            },
          },
          despesas: {
            total: Number(despesasAno[0]?.total || 0),
            pago: Number(despesasAno[0]?.pago || 0),
            pendente: Number(despesasAno[0]?.pendente || 0),
          },
        },
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao carregar balancete.', detail: error.message });
    }
  }

  async publicarBalancete(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!['Admin', 'Sindico'].includes(req.nomePerfil)) return res.status(403).json({ message: 'Apenas Admin ou Síndico podem publicar balancetes.' });

      const periodo = this._normalizarPeriodo(req.body.competencia) || this._normalizarPeriodo(req.body.periodo);
      if (!periodo) return res.status(422).json({ message: 'competencia (ou periodo) é obrigatório.' });

      const enviarEmail = String(req.body.enviar_email) === '1';
      const idPublicadoPor = this._toInt(req.idcliente, null);
      const replacements = { id_condominio: idCondominio, periodo };

      const [totaisReceitas, totaisDespesas] = await Promise.all([
        postgres.query(
          `SELECT COALESCE(SUM(valor + COALESCE(valor_fundo_reserva, 0)), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
              AND situacao = 'pago'`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT COALESCE(SUM(valor), 0)::numeric AS total
             FROM "condominio-bh".tb_fin_despesas
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
              AND situacao = 'pago'`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const totalReceitas = Number(totaisReceitas[0]?.total || 0);
      const totalDespesas = Number(totaisDespesas[0]?.total || 0);
      const saldoFinal = totalReceitas - totalDespesas;

      const saldoCaixaReplacements = { ...replacements, total_receitas: totalReceitas, total_despesas: totalDespesas, saldo_final: saldoFinal };
      const [saldoCaixaAtualizado] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_saldo_caixa
            SET total_receitas = :total_receitas,
                total_despesas = :total_despesas,
                saldo_final    = :saldo_final,
                publicado      = true,
                publicado_em   = now()
          WHERE id_condominio = :id_condominio AND competencia = TO_DATE(:periodo, 'YYYY-MM')
          RETURNING id`,
        { replacements: saldoCaixaReplacements }
      );
      if (!saldoCaixaAtualizado[0]) {
        await postgres.query(
          `INSERT INTO "condominio-bh".tb_fin_saldo_caixa
              (id_condominio, competencia, saldo_inicial, total_receitas, total_despesas, saldo_final, publicado, publicado_em, created_at)
             VALUES (:id_condominio, TO_DATE(:periodo, 'YYYY-MM'), 0, :total_receitas, :total_despesas, :saldo_final, true, now(), now())`,
          { replacements: saldoCaixaReplacements }
        );
      }

      const balanceteReplacements = { ...replacements, publicado_por: idPublicadoPor };
      const [balanceteAtualizado] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_balancetes
            SET publicado     = true,
                publicado_em  = now(),
                publicado_por = :publicado_por
          WHERE id_condominio = :id_condominio AND competencia = TO_DATE(:periodo, 'YYYY-MM')
          RETURNING *`,
        { replacements: balanceteReplacements }
      );
      let balancete = balanceteAtualizado[0];
      if (!balancete) {
        const [balanceteInserido] = await postgres.query(
          `INSERT INTO "condominio-bh".tb_fin_balancetes
              (id_condominio, competencia, publicado, publicado_em, publicado_por, created_at)
             VALUES (:id_condominio, TO_DATE(:periodo, 'YYYY-MM'), true, now(), :publicado_por, now())
             RETURNING *`,
          { replacements: balanceteReplacements }
        );
        balancete = balanceteInserido[0];
      }

      res.status(200).json({
        message: 'Balancete publicado.',
        balancete,
        total_receitas: totalReceitas,
        total_despesas: totalDespesas,
        saldo_final: saldoFinal,
      });

      // Notifica moradores via push / log / e-mail — cada etapa isolada, uma falha não bloqueia as demais
      setImmediate(async () => {
        const mesesAbrev = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
        const mesesCompletos = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const [anoPeriodo, mesPeriodo] = periodo.split('-');
        const mensagemNotificacao = `Houve publicação da Prestação Contas ${mesesAbrev[Number(mesPeriodo) - 1]}/${anoPeriodo}, acompanhe no dashboard`;
        const competenciaFormatada = `${mesesCompletos[Number(mesPeriodo) - 1]}/${anoPeriodo}`;
        const idCodigoBalancete = this._toInt(balancete?.id, null);

        let ids = [];
        try {
          const moradores = await postgres.query(
            `SELECT DISTINCT u.id
               FROM "condominio-bh"."tb-usuarios" u
              WHERE u.id_condominio = :id_condominio AND LOWER(u.status) = 'ativo'`,
            { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
          );
          ids = moradores.map((m) => m.id);
          if (ids.length > 0) {
            await pushNotificationService.enviarParaUsuarios(ids, {
              title: 'Balancete Disponível',
              body: `O balancete de ${periodo} foi publicado.`,
              data: { tipo: 'financeiro', periodo },
            });
          }
        } catch (pushErr) {
          console.error('[publicarBalancete] Erro no push:', pushErr?.message);
        }

        try {
          for (const idMorador of ids) {
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
                  id_notificacao_tipo: 9,
                  id_usuario: this._toInt(idMorador, null),
                  mensagem: mensagemNotificacao,
                  id_usuario_pedido: idPublicadoPor,
                  id_condominio: idCondominio,
                  id_codigo: idCodigoBalancete,
                },
              }
            );
          }
        } catch (logErr) {
          console.error('[publicarBalancete] Erro no log de notificação:', logErr?.message);
        }

        if (enviarEmail) {
          try {
            const destinatarios = await postgres.query(
              `SELECT DISTINCT u.id, u.nome, u.email, c.nome AS condominio_nome
                 FROM "condominio-bh"."tb-usuarios" u
                 LEFT JOIN "condominio-bh".tb_sgw_perfil p ON p.id::text = u.tipo_perfil_id::text
                 LEFT JOIN "condominio-bh"."tb-condominios" c ON c.id::text = u.id_condominio::text
                WHERE u.id_condominio = :id_condominio
                  AND LOWER(u.status) = 'ativo'
                  AND COALESCE(p.nome, '') != 'Portaria'
                  AND u.email IS NOT NULL AND u.email <> ''`,
              { replacements: { id_condominio: idCondominio }, type: QueryTypes.SELECT }
            );

            console.log(`[publicarBalancete] Disparando e-mail para ${destinatarios.length} destinatário(s), template=balancete_publicado.`);

            if (destinatarios.length > 0) {
              try {
                await despacharEmail({
                  _ref: `balancete_${idCondominio}_${periodo}`,
                  template: 'balancete_publicado',
                  emails: destinatarios.map((d) => d.email),
                  balancete: {
                    competencia: competenciaFormatada,
                    condominio_nome: destinatarios[0]?.condominio_nome || '',
                  },
                });
              } catch (emailErr) {
                console.error('[publicarBalancete] Erro ao enviar e-mail em lote:', emailErr?.message);
              }
            }
          } catch (destinatariosErr) {
            console.error('[publicarBalancete] Erro no disparo de e-mail:', destinatariosErr?.message);
          }
        }
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao publicar balancete.', detail: error.message });
    }
  }

  // ─── Documentos da competência ─────────────────────────────────────────────

  async listarDocumentosCompetencia(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });

      const periodo = this._periodoDaQuery(req) || this._periodoAtual();
      const replacements = { id_condominio: idCondominio, periodo };

      // Moradores só veem documentos de competências com balancete publicado
      if (!this._isGestor(req)) {
        const publicado = await postgres.query(
          `SELECT 1
             FROM "condominio-bh".tb_fin_balancetes
            WHERE id_condominio = :id_condominio
              AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
              AND publicado = true`,
          { replacements, type: QueryTypes.SELECT }
        );
        if (!publicado[0]) return res.status(404).json({ message: 'Balancete não publicado para este período.' });
      }

      const data = await postgres.query(
        `SELECT id, tipo, nome_arquivo, caminho_arquivo, data_envio
           FROM "condominio-bh".tb_fin_documentos_competencia
          WHERE id_condominio = :id_condominio
            AND TO_CHAR(competencia, 'YYYY-MM') = :periodo
          ORDER BY data_envio DESC`,
        { replacements, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ periodo, data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar documentos da competência.', detail: error.message });
    }
  }

  async uploadDocumentoCompetencia(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });
      if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });

      const periodo = this._normalizarPeriodo(req.body.competencia);
      const tipo = req.body.tipo;
      const arquivo = req.file;
      const ext = (arquivo.originalname.split('.').pop() || 'bin').toLowerCase();
      const ambiente = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
      const nomeArquivo = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
      const blobPath = `${ambiente}/condominios/${idCondominio}/financeiro/competencias/${periodo}/${nomeArquivo}`;

      const uploadResult = await put(blobPath, arquivo.buffer, { access: 'private', contentType: arquivo.mimetype });
      const caminhoArquivo = uploadResult?.url || blobPath;

      const [docRows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_documentos_competencia
            (id_condominio, competencia, tipo, nome_arquivo, caminho_arquivo, id_usuario_cadastro, data_envio)
           VALUES (:id_condominio, :competencia::date, :tipo, :nome_arquivo, :caminho_arquivo, :id_usuario_cadastro, now())
           RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominio,
            competencia: `${periodo}-01`,
            tipo,
            nome_arquivo: arquivo.originalname,
            caminho_arquivo: caminhoArquivo,
            id_usuario_cadastro: this._toInt(req.idcliente, null),
          },
        }
      );

      return res.status(201).json(docRows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao fazer upload do documento.', detail: error.message });
    }
  }

  async excluirDocumentoCompetencia(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);

      const docs = await postgres.query(
        `SELECT id, caminho_arquivo
           FROM "condominio-bh".tb_fin_documentos_competencia
          WHERE id = :id AND id_condominio = :id_condominio`,
        { replacements: { id, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      if (!docs[0]) return res.status(404).json({ message: 'Documento não encontrado.' });

      try {
        const { del } = require('@vercel/blob');
        await del(docs[0].caminho_arquivo);
      } catch (_) {
        // remoção do blob é melhor esforço
      }

      await postgres.query(
        `DELETE FROM "condominio-bh".tb_fin_documentos_competencia WHERE id = :id`,
        { replacements: { id } }
      );

      return res.status(200).json({ message: 'Documento removido.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao remover documento.', detail: error.message });
    }
  }

  // ─── Fornecedores ───────────────────────────────────────────────────────────

  async listarFornecedores(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const whereParts = ['f.id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio, limit: pageSize, offset };

      if (req.query.categoria) {
        whereParts.push('f.categoria = :categoria');
        replacements.categoria = req.query.categoria;
      }
      if (req.query.tipo_pessoa) {
        whereParts.push('f.tipo_pessoa = :tipo_pessoa');
        replacements.tipo_pessoa = req.query.tipo_pessoa;
      }
      if (req.query.ativo !== undefined) {
        whereParts.push('f.ativo = :ativo');
        replacements.ativo = String(req.query.ativo) === 'true';
      }
      if (req.query.busca) {
        whereParts.push('(f.nome ILIKE :busca OR f.nome_fantasia ILIKE :busca OR f.cpf_cnpj ILIKE :busca)');
        replacements.busca = `%${req.query.busca}%`;
      }

      const whereClause = whereParts.join(' AND ');

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total FROM "condominio-bh".tb_fin_fornecedor f WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT f.*
             FROM "condominio-bh".tb_fin_fornecedor f
            WHERE ${whereClause}
            ORDER BY f.nome
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const total = totalRows[0]?.total || 0;
      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        data,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar fornecedores.', detail: error.message });
    }
  }

  async obterFornecedor(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);

      const rows = await postgres.query(
        `SELECT * FROM "condominio-bh".tb_fin_fornecedor WHERE id = :id AND id_condominio = :id_condominio`,
        { replacements: { id, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Fornecedor não encontrado.' });
      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao obter fornecedor.', detail: error.message });
    }
  }

  async criarFornecedor(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const {
        nome, nome_fantasia, tipo_pessoa, cpf_cnpj, inscricao_estadual, inscricao_municipal,
        telefone, celular, whatsapp, email, site, cep, endereco, numero, complemento,
        bairro, cidade, estado, banco, agencia, conta, tipo_conta, chave_pix, tipo_pix,
        observacao, categoria,
      } = req.body;

      const [rows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_fornecedor (
            id_condominio, nome, nome_fantasia, tipo_pessoa, cpf_cnpj, inscricao_estadual,
            inscricao_municipal, telefone, celular, whatsapp, email, site, cep, endereco,
            numero, complemento, bairro, cidade, estado, banco, agencia, conta, tipo_conta,
            chave_pix, tipo_pix, observacao, categoria, ativo, created_at, updated_at
          ) VALUES (
            :id_condominio, :nome, :nome_fantasia, :tipo_pessoa, :cpf_cnpj, :inscricao_estadual,
            :inscricao_municipal, :telefone, :celular, :whatsapp, :email, :site, :cep, :endereco,
            :numero, :complemento, :bairro, :cidade, :estado, :banco, :agencia, :conta, :tipo_conta,
            :chave_pix, :tipo_pix, :observacao, :categoria, true, now(), now()
          ) RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominio,
            nome: this._normalizarTextoOuNull(nome),
            nome_fantasia: this._normalizarTextoOuNull(nome_fantasia),
            tipo_pessoa: tipo_pessoa || 'J',
            cpf_cnpj: this._normalizarTextoOuNull(cpf_cnpj),
            inscricao_estadual: this._normalizarTextoOuNull(inscricao_estadual),
            inscricao_municipal: this._normalizarTextoOuNull(inscricao_municipal),
            telefone: this._normalizarTextoOuNull(telefone),
            celular: this._normalizarTextoOuNull(celular),
            whatsapp: this._normalizarTextoOuNull(whatsapp),
            email: this._normalizarTextoOuNull(email),
            site: this._normalizarTextoOuNull(site),
            cep: this._normalizarTextoOuNull(cep),
            endereco: this._normalizarTextoOuNull(endereco),
            numero: this._normalizarTextoOuNull(numero),
            complemento: this._normalizarTextoOuNull(complemento),
            bairro: this._normalizarTextoOuNull(bairro),
            cidade: this._normalizarTextoOuNull(cidade),
            estado: this._normalizarTextoOuNull(estado),
            banco: this._normalizarTextoOuNull(banco),
            agencia: this._normalizarTextoOuNull(agencia),
            conta: this._normalizarTextoOuNull(conta),
            tipo_conta: this._normalizarTextoOuNull(tipo_conta),
            chave_pix: this._normalizarTextoOuNull(chave_pix),
            tipo_pix: this._normalizarTextoOuNull(tipo_pix),
            observacao: this._normalizarTextoOuNull(observacao),
            categoria: this._normalizarTextoOuNull(categoria),
          },
        }
      );

      return res.status(201).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao criar fornecedor.', detail: error.message });
    }
  }

  async atualizarFornecedor(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);
      const campos = ['updated_at = now()'];
      const replacements = { id, id_condominio: idCondominio };

      const camposPermitidos = [
        'nome', 'nome_fantasia', 'tipo_pessoa', 'cpf_cnpj', 'inscricao_estadual', 'inscricao_municipal',
        'telefone', 'celular', 'whatsapp', 'email', 'site', 'cep', 'endereco', 'numero', 'complemento',
        'bairro', 'cidade', 'estado', 'banco', 'agencia', 'conta', 'tipo_conta', 'chave_pix', 'tipo_pix',
        'observacao', 'categoria',
      ];

      for (const campo of camposPermitidos) {
        if (req.body[campo] !== undefined) {
          campos.push(`${campo} = :${campo}`);
          replacements[campo] = this._normalizarTextoOuNull(req.body[campo]);
        }
      }

      if (campos.length === 1) return res.status(422).json({ message: 'Nenhum campo para atualizar.' });

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_fornecedor
            SET ${campos.join(', ')}
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING *`,
        { replacements }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Fornecedor não encontrado.' });
      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar fornecedor.', detail: error.message });
    }
  }

  async atualizarStatusFornecedor(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);
      const ativo = req.body.ativo === true || String(req.body.ativo) === 'true';

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_fornecedor
            SET ativo = :ativo, updated_at = now()
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING *`,
        { replacements: { id, id_condominio: idCondominio, ativo } }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Fornecedor não encontrado.' });
      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar status do fornecedor.', detail: error.message });
    }
  }

  async excluirFornecedor(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_fornecedor
            SET ativo = false, updated_at = now()
          WHERE id = :id AND id_condominio = :id_condominio
          RETURNING id`,
        { replacements: { id, id_condominio: idCondominio } }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Fornecedor não encontrado.' });
      return res.status(200).json({ message: 'Fornecedor inativado.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao inativar fornecedor.', detail: error.message });
    }
  }
}

module.exports = FinanceiroController;
