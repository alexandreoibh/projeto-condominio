'use strict';

const { QueryTypes } = require('sequelize');
const { put } = require('@vercel/blob');
const postgres = require('../database/postgres');

const PERFIS_GESTAO = new Set(['Admin', 'Sindico', 'Sub-Sindico']);

const UNIDADE_TEMPO_SQL = {
  DIA: 'day',
  SEMANA: 'week',
  MES: 'month',
  ANO: 'year',
};

const UNIDADE_TEMPO_FREQUENCIA = {
  DIA: 'DIARIA',
  SEMANA: 'SEMANAL',
  MES: 'MENSAL',
  ANO: 'ANUAL',
};

class ManutencaoController {
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

  _normalizeUpper(value) {
    if (value === undefined || value === null) return null;
    return String(value).trim().toUpperCase();
  }

  _normalizeUnidadeTempo(value) {
    const normalized = this._normalizeUpper(value);
    if (!normalized) return null;
    const aliases = {
      DIAS: 'DIA',
      SEMANAS: 'SEMANA',
      MESES: 'MES',
      ANOS: 'ANO',
      DIA: 'DIA',
      SEMANA: 'SEMANA',
      MES: 'MES',
      ANO: 'ANO',
    };
    return aliases[normalized] || null;
  }

  _normalizeFrequencia(value) {
    const normalized = this._normalizeUpper(value);
    const valid = new Set(['DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']);
    return valid.has(normalized) ? normalized : null;
  }

  _normalizeAtivo(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 'S' : 'N';
    const normalized = this._normalizeUpper(value);
    if (['S', 'SIM', 'TRUE', '1'].includes(normalized)) return 'S';
    if (['N', 'NAO', 'NÃO', 'FALSE', '0'].includes(normalized)) return 'N';
    return null;
  }

  _isGestor(req) {
    return PERFIS_GESTAO.has(req.nomePerfil);
  }

  // ─── Tipos de Rotina ─────────────────────────────────────────────────────────

  async listarTiposRotina(req, res) {
    try {
      const somenteAtivos = req.query.ativo !== 'todos';
      const whereClause = somenteAtivos ? "WHERE ativo = 'S'" : '';

      const data = await postgres.query(
        `SELECT id_tipo_rotina, nome_tipo, descricao, ativo
           FROM "condominio-bh".tb_manutencao_tipo_rotina
           ${whereClause}
          ORDER BY nome_tipo`,
        { type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar tipos de rotina.', detail: error.message });
    }
  }

  // ─── Rotinas de Manutenção ───────────────────────────────────────────────────

  async listarRotinas(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const whereParts = ['r.id_condominio = :id_condominio'];
      const replacements = { id_condominio: idCondominio, limit: pageSize, offset };

      if (req.query.status_rotina) {
        whereParts.push('r.status_rotina = :status_rotina');
        replacements.status_rotina = req.query.status_rotina;
      }
      if (req.query.id_tipo_rotina) {
        whereParts.push('r.id_tipo_rotina = :id_tipo_rotina');
        replacements.id_tipo_rotina = this._toInt(req.query.id_tipo_rotina, null);
      }
      if (req.query.ativo) {
        whereParts.push('r.ativo = :ativo');
        replacements.ativo = req.query.ativo;
      }

      const whereClause = whereParts.join(' AND ');

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total FROM "condominio-bh".tb_manutencao_rotina r WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT r.*, t.nome_tipo, t.descricao AS tipo_descricao,ff.nome as nome_fornecedor
             FROM "condominio-bh".tb_manutencao_rotina r
             LEFT JOIN "condominio-bh".tb_manutencao_tipo_rotina t 
              ON t.id_tipo_rotina = r.id_tipo_rotina
             LEFT JOIN "condominio-bh".tb_fin_fornecedor ff 
              ON ff.id = r.id_fornecedor 
            WHERE ${whereClause}
            ORDER BY r.proxima_execucao ASC, r.id_rotina_manutencao DESC
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
      return res.status(500).json({ message: 'Falha ao listar rotinas de manutenção.', detail: error.message });
    }
  }

  async listarProximasManutencoes(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });

      const dias = this._toInt(req.query.dias, 30);
      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;

      const replacements = { id_condominio: idCondominio, dias, limit: pageSize, offset };

      const whereClause = `
        r.id_condominio = :id_condominio
        AND r.ativo = 'S'
        AND r.status_rotina NOT IN ('CONCLUIDA', 'CANCELADA')
        AND r.proxima_execucao BETWEEN CURRENT_DATE AND (CURRENT_DATE + (:dias || ' day')::interval)
      `;

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total FROM "condominio-bh".tb_manutencao_rotina r WHERE ${whereClause}`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT r.*, t.nome_tipo, t.descricao AS tipo_descricao, ff.nome as nome_fornecedor
             FROM "condominio-bh".tb_manutencao_rotina r
             LEFT JOIN "condominio-bh".tb_manutencao_tipo_rotina t
              ON t.id_tipo_rotina = r.id_tipo_rotina
             LEFT JOIN "condominio-bh".tb_fin_fornecedor ff
              ON ff.id = r.id_fornecedor
            WHERE ${whereClause}
            ORDER BY r.proxima_execucao ASC, r.id_rotina_manutencao DESC
            LIMIT :limit OFFSET :offset`,
          { replacements, type: QueryTypes.SELECT }
        ),
      ]);

      const total = totalRows[0]?.total || 0;
      return res.status(200).json({
        dias,
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        data,
      });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar próximas manutenções.', detail: error.message });
    }
  }

  async criarRotina(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const {
        id_tipo_rotina, tipo, id_fornecedor, nome_rotina, nome, descricao, local_rotina,
        frequencia, intervalo_execucao, unidade_tempo, data_inicio, proxima_execucao,
        custo_estimado, observacao, ativo,
      } = req.body;

      const idTipoRotina = this._toInt(id_tipo_rotina ?? tipo, null);
      const tipoRows = await postgres.query(
        `SELECT id_tipo_rotina, descricao FROM "condominio-bh".tb_manutencao_tipo_rotina WHERE id_tipo_rotina = :id LIMIT 1`,
        { replacements: { id: idTipoRotina }, type: QueryTypes.SELECT }
      );
      if (!tipoRows[0]) return res.status(422).json({ message: 'id_tipo_rotina não encontrado.' });

      const existenteRows = await postgres.query(
        `SELECT id_rotina_manutencao FROM "condominio-bh".tb_manutencao_rotina
          WHERE id_condominio = :id_condominio AND id_tipo_rotina = :id_tipo_rotina
            AND ativo = 'S' AND status_rotina <> 'CANCELADA'
          LIMIT 1`,
        { replacements: { id_condominio: idCondominio, id_tipo_rotina: idTipoRotina }, type: QueryTypes.SELECT }
      );
      if (existenteRows[0]) {
        return res.status(409).json({
          message: 'Já existe uma rotina cadastrada para este tipo de manutenção. Edite a rotina existente em vez de criar uma nova.',
          id_rotina_manutencao: existenteRows[0].id_rotina_manutencao,
        });
      }

      const intervaloExecucao = this._toInt(intervalo_execucao, 1);
      const unidadeTempo = this._normalizeUnidadeTempo(unidade_tempo) || 'MES';
      const unidadeSql = UNIDADE_TEMPO_SQL[unidadeTempo];
      const frequenciaNormalized = this._normalizeFrequencia(frequencia) || UNIDADE_TEMPO_FREQUENCIA[unidadeTempo];
      const dataInicio = this._normalizarTextoOuNull(data_inicio || proxima_execucao);
      const proximaExecucao = this._normalizarTextoOuNull(proxima_execucao);
      const nomeRotinaFinal = this._normalizarTextoOuNull(tipoRows[0].descricao) || this._normalizarTextoOuNull(nome_rotina ?? nome);
      const ativoFinal = this._normalizeAtivo(ativo) ?? 'S';

      const [rows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_manutencao_rotina (
            id_condominio, id_tipo_rotina, id_fornecedor, nome_rotina, descricao, local_rotina,
            frequencia, intervalo_execucao, unidade_tempo, data_inicio, proxima_execucao,
            custo_estimado, observacao, ativo, criado_por, data_criacao, data_atualizacao
          ) VALUES (
            :id_condominio, :id_tipo_rotina, :id_fornecedor, :nome_rotina, :descricao, :local_rotina,
            :frequencia, :intervalo_execucao, :unidade_tempo, :data_inicio::date,
            COALESCE(:proxima_execucao::date, (:data_inicio::date + (:intervalo_execucao || ' ' || :unidade_sql)::interval)::date),
            :custo_estimado, :observacao, :ativo, :criado_por, now(), now()
          ) RETURNING *`,
        {
          replacements: {
            id_condominio: idCondominio,
            id_tipo_rotina: idTipoRotina,
            id_fornecedor: this._toInt(id_fornecedor, null),
            nome_rotina: nomeRotinaFinal,
            descricao: this._normalizarTextoOuNull(descricao),
            local_rotina: this._normalizarTextoOuNull(local_rotina),
            frequencia: frequenciaNormalized,
            intervalo_execucao: intervaloExecucao,
            unidade_tempo: unidadeTempo,
            unidade_sql: unidadeSql,
            data_inicio: dataInicio,
            proxima_execucao: proximaExecucao,
            custo_estimado: this._parseDecimalOuNull(custo_estimado),
            observacao: this._normalizarTextoOuNull(observacao),
            ativo: ativoFinal,
            criado_por: this._toInt(req.idcliente, null),
          },
        }
      );

      return res.status(201).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao criar rotina de manutenção.', detail: error.message });
    }
  }

  async atualizarRotina(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);
      const campos = ['atualizado_por = :atualizado_por', 'data_atualizacao = now()'];
      const replacements = { id, id_condominio: idCondominio, atualizado_por: this._toInt(req.idcliente, null) };

      const camposDatas = new Set(['data_inicio', 'proxima_execucao', 'ultima_execucao']);
      const camposInt = new Set(['id_tipo_rotina', 'id_fornecedor', 'intervalo_execucao']);
      const camposDecimais = new Set(['custo_estimado']);
      const camposPermitidos = [
        'id_tipo_rotina', 'id_fornecedor', 'nome_rotina', 'descricao', 'local_rotina',
        'frequencia', 'intervalo_execucao', 'unidade_tempo', 'data_inicio', 'proxima_execucao',
        'ultima_execucao', 'custo_estimado', 'ativo', 'status_rotina', 'observacao',
      ];

      const tipoRotinaId = this._toInt(req.body.id_tipo_rotina ?? req.body.tipo, null);
      let nomeRotinaFromTipo = null;
      if (tipoRotinaId !== null) {
        const tipoRows = await postgres.query(
          `SELECT id_tipo_rotina, descricao FROM "condominio-bh".tb_manutencao_tipo_rotina WHERE id_tipo_rotina = :id LIMIT 1`,
          { replacements: { id: tipoRotinaId }, type: QueryTypes.SELECT }
        );
        if (!tipoRows[0]) return res.status(422).json({ message: 'id_tipo_rotina não encontrado.' });
        nomeRotinaFromTipo = this._normalizarTextoOuNull(tipoRows[0].descricao);
      }

      const unidadeTempoBody = req.body.unidade_tempo !== undefined
        ? this._normalizeUnidadeTempo(req.body.unidade_tempo)
        : null;

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
          } else if (campo === 'frequencia') {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizeFrequencia(req.body[campo])
              || (unidadeTempoBody ? UNIDADE_TEMPO_FREQUENCIA[unidadeTempoBody] : null);
          } else if (campo === 'unidade_tempo') {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizeUnidadeTempo(req.body[campo]);
          } else if (campo === 'ativo') {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizeAtivo(req.body[campo]);
          } else {
            campos.push(`${campo} = :${campo}`);
            replacements[campo] = this._normalizarTextoOuNull(req.body[campo]);
          }
        }
      }

      if (nomeRotinaFromTipo !== null) {
        if (!campos.includes('nome_rotina = :nome_rotina')) {
          campos.push('nome_rotina = :nome_rotina');
        }
        replacements.nome_rotina = nomeRotinaFromTipo;
      }

      if (req.body.nome !== undefined && req.body.nome !== null && nomeRotinaFromTipo === null) {
        if (!campos.includes('nome_rotina = :nome_rotina')) {
          campos.push('nome_rotina = :nome_rotina');
        }
        replacements.nome_rotina = this._normalizarTextoOuNull(req.body.nome);
      }

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_manutencao_rotina
            SET ${campos.join(', ')}
          WHERE id_rotina_manutencao = :id AND id_condominio = :id_condominio
          RETURNING *`,
        { replacements }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Rotina de manutenção não encontrada.' });

      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar rotina de manutenção.', detail: error.message });
    }
  }

  async atualizarStatusRotina(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._toInt(req.params.id, null);
      const campos = ['atualizado_por = :atualizado_por', 'data_atualizacao = now()'];
      const replacements = { id, id_condominio: idCondominio, atualizado_por: this._toInt(req.idcliente, null) };

      const tipoRotinaId = this._toInt(req.body.id_tipo_rotina ?? req.body.tipo, null);
      if (tipoRotinaId !== null) {
        const tipoRows = await postgres.query(
          `SELECT id_tipo_rotina, descricao FROM "condominio-bh".tb_manutencao_tipo_rotina WHERE id_tipo_rotina = :id LIMIT 1`,
          { replacements: { id: tipoRotinaId }, type: QueryTypes.SELECT }
        );
        if (!tipoRows[0]) return res.status(422).json({ message: 'id_tipo_rotina não encontrado.' });
        campos.push('id_tipo_rotina = :id_tipo_rotina');
        replacements.id_tipo_rotina = tipoRotinaId;
        campos.push('nome_rotina = :nome_rotina');
        replacements.nome_rotina = this._normalizarTextoOuNull(tipoRows[0].descricao);
      }

      if (req.body.nome_rotina !== undefined) {
        campos.push('nome_rotina = :nome_rotina');
        replacements.nome_rotina = this._normalizarTextoOuNull(req.body.nome_rotina);
      }
      if (req.body.nome !== undefined && tipoRotinaId === null) {
        campos.push('nome_rotina = :nome_rotina');
        replacements.nome_rotina = this._normalizarTextoOuNull(req.body.nome);
      }
      if (req.body.status_rotina !== undefined) {
        campos.push('status_rotina = :status_rotina');
        replacements.status_rotina = req.body.status_rotina;
      }
      if (req.body.ativo !== undefined) {
        campos.push('ativo = :ativo');
        replacements.ativo = this._normalizeAtivo(req.body.ativo);
      }

      if (campos.length === 2) {
        return res.status(422).json({ message: 'Informe ao menos status_rotina, ativo ou tipo/id_tipo_rotina.' });
      }

      const [rows] = await postgres.query(
        `UPDATE "condominio-bh".tb_manutencao_rotina
            SET ${campos.join(', ')}
          WHERE id_rotina_manutencao = :id AND id_condominio = :id_condominio
          RETURNING *`,
        { replacements }
      );

      if (!rows[0]) return res.status(404).json({ message: 'Rotina de manutenção não encontrada.' });

      return res.status(200).json(rows[0]);
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao atualizar status da rotina.', detail: error.message });
    }
  }

  // ─── Execuções ───────────────────────────────────────────────────────────────

  async listarExecucoes(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });

      const idRotina = this._toInt(req.params.id, null);
      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 200);
      const offset = (page - 1) * pageSize;
      const replacements = { id_rotina: idRotina, id_condominio: idCondominio, limit: pageSize, offset };

      const rotinaRows = await postgres.query(
        `SELECT id_rotina_manutencao FROM "condominio-bh".tb_manutencao_rotina
          WHERE id_rotina_manutencao = :id_rotina AND id_condominio = :id_condominio LIMIT 1`,
        { replacements, type: QueryTypes.SELECT }
      );
      if (!rotinaRows[0]) return res.status(404).json({ message: 'Rotina de manutenção não encontrada.' });

      const [totalRows, data] = await Promise.all([
        postgres.query(
          `SELECT COUNT(*)::int AS total
             FROM "condominio-bh".tb_manutencao_execucao_log
            WHERE id_rotina_manutencao = :id_rotina`,
          { replacements, type: QueryTypes.SELECT }
        ),
        postgres.query(
          `SELECT log.*, ff.nome AS nome_fornecedor
             FROM "condominio-bh".tb_manutencao_execucao_log log
             LEFT JOIN "condominio-bh".tb_fin_fornecedor ff
              ON ff.id = log.id_fornecedor
            WHERE log.id_rotina_manutencao = :id_rotina
            ORDER BY log.data_execucao DESC, log.id_execucao_rotina DESC
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
      return res.status(500).json({ message: 'Falha ao listar execuções da rotina.', detail: error.message });
    }
  }

  async registrarExecucao(req, res) {
    try {
      const idCondominio = this._toInt(req.id_condominio, null);
      if (!idCondominio) return res.status(403).json({ message: 'Token sem id_condominio.' });
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const idRotina = this._toInt(req.params.id, null);
      const { data_execucao, status_execucao, id_fornecedor, custo_real, observacao_execucao, anexo_execucao } = req.body;

      const rotinaRows = await postgres.query(
        `SELECT id_rotina_manutencao, intervalo_execucao, unidade_tempo
           FROM "condominio-bh".tb_manutencao_rotina
          WHERE id_rotina_manutencao = :id_rotina AND id_condominio = :id_condominio LIMIT 1`,
        { replacements: { id_rotina: idRotina, id_condominio: idCondominio }, type: QueryTypes.SELECT }
      );
      const rotina = rotinaRows[0];
      if (!rotina) return res.status(404).json({ message: 'Rotina de manutenção não encontrada.' });

      const unidadeSql = UNIDADE_TEMPO_SQL[rotina.unidade_tempo];
      const dataExecucao = data_execucao || new Date().toISOString().slice(0, 10);

      const arquivos = Array.isArray(req.files) ? req.files : [];
      const ambiente = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
      const urlsFotos = [];
      for (const arquivo of arquivos) {
        const ext = (arquivo.originalname.split('.').pop() || 'bin').toLowerCase();
        const nomeArquivo = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
        const blobPath = `${ambiente}/condominios/${idCondominio}/manutencao/rotinas/${idRotina}/execucoes/${nomeArquivo}`;
        const uploadResult = await put(blobPath, arquivo.buffer, { access: 'private', contentType: arquivo.mimetype });
        urlsFotos.push(uploadResult?.url || blobPath);
      }

      const [logRows] = await postgres.query(
        `INSERT INTO "condominio-bh".tb_manutencao_execucao_log (
            id_rotina_manutencao, data_execucao, data_proxima_execucao, status_execucao,
            id_fornecedor, custo_real, observacao_execucao, anexo_execucao, anexos_execucao,
            executado_por, data_registro
          ) VALUES (
            :id_rotina, :data_execucao::date,
            (:data_execucao::date + (:intervalo || ' ' || :unidade_sql)::interval)::date,
            :status_execucao, :id_fornecedor, :custo_real, :observacao_execucao, :anexo_execucao,
            :anexos_execucao, :executado_por, now()
          ) RETURNING *`,
        {
          replacements: {
            id_rotina: idRotina,
            data_execucao: dataExecucao,
            intervalo: rotina.intervalo_execucao,
            unidade_sql: unidadeSql,
            status_execucao: status_execucao || 'CONCLUIDA',
            id_fornecedor: this._toInt(id_fornecedor, null),
            custo_real: this._parseDecimalOuNull(custo_real),
            observacao_execucao: this._normalizarTextoOuNull(observacao_execucao),
            anexo_execucao: this._normalizarTextoOuNull(anexo_execucao),
            anexos_execucao: JSON.stringify(urlsFotos),
            executado_por: this._toInt(req.idcliente, null),
          },
        }
      );

      const execucao = logRows[0];

      const [rotinaAtualizadaRows] = await postgres.query(
        `UPDATE "condominio-bh".tb_manutencao_rotina
            SET ultima_execucao = :data_execucao::date,
                proxima_execucao = :proxima_execucao::date,
                status_rotina = 'EM_DIA',
                atualizado_por = :atualizado_por,
                data_atualizacao = now()
          WHERE id_rotina_manutencao = :id_rotina AND id_condominio = :id_condominio
          RETURNING *`,
        {
          replacements: {
            id_rotina: idRotina,
            id_condominio: idCondominio,
            data_execucao: dataExecucao,
            proxima_execucao: execucao.data_proxima_execucao,
            atualizado_por: this._toInt(req.idcliente, null),
          },
        }
      );

      return res.status(201).json({ execucao, rotina: rotinaAtualizadaRows[0] });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao registrar execução da rotina.', detail: error.message });
    }
  }
}

module.exports = ManutencaoController;
