const postgres = require('../database/postgres');
const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');

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

  async _podeVisualizarDadosMorador(req) {
    const perfilToken = this._normalizarPerfil(req.nomePerfil);
    if (perfilToken === 'admin' || perfilToken === 'sindico') {
      return true;
    }

    const idPerfilToken = this._toInt(req.IdPerfil, null);
    if (idPerfilToken === 1 || idPerfilToken === 3) {
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
    return idPerfilDb === 1 || idPerfilDb === 3;
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
          c.updated_at,
          COALESCE(
            (
              SELECT ARRAY_AGG(cu.unidades_bloco ORDER BY cu.id)
                FROM "condominio-bh".tb_condominios_unidades cu
               WHERE cu.id_condominio = c.id
            ),
            ARRAY[]::varchar[]
          ) AS unidades_bloco
        FROM "condominio-bh"."tb-condominios" c
       WHERE c.id = :id
       LIMIT 1`,
      {
        replacements: { id: idCondominio },
        type: QueryTypes.SELECT,
        transaction
      }
    );

    return rows && rows.length > 0 ? rows[0] : null;
  }

  async _sincronizarUnidadesCondominio(idCondominio, unidadesBloco, transaction) {
    await postgres.query(
      `DELETE FROM "condominio-bh".tb_condominios_unidades
        WHERE id_condominio = :id_condominio`,
      {
        replacements: { id_condominio: idCondominio },
        type: QueryTypes.DELETE,
        transaction
      }
    );

    for (const unidade of unidadesBloco) {
      await postgres.query(
        `INSERT INTO "condominio-bh".tb_condominios_unidades (
            id_condominio,
            unidades_bloco,
            created_at
          ) VALUES (
            :id_condominio,
            :unidades_bloco,
            now()
          )`,
        {
          replacements: {
            id_condominio: idCondominio,
            unidades_bloco: unidade
          },
          transaction
        }
      );
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
                SELECT ARRAY_AGG(cu.unidades_bloco ORDER BY cu.id)
                  FROM "condominio-bh".tb_condominios_unidades cu
                 WHERE cu.id_condominio = c.id
              ),
              ARRAY[]::varchar[]
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
                SELECT ARRAY_AGG(cu.unidades_bloco ORDER BY cu.id)
                  FROM "condominio-bh".tb_condominios_unidades cu
                 WHERE cu.id_condominio = c.id
              ),
              ARRAY[]::varchar[]
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
      await this._sincronizarUnidadesCondominio(idCondominio, unidadesBloco, transaction);

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
        await this._sincronizarUnidadesCondominio(id, unidadesBlocoInformadas, transaction);
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
      const menus = await postgres.query(
        `SELECT
            id,
            nome,
            rota,
            icone,
            nivel,
            id_menu_pai,
            ordem,
            status
          FROM "condominio-bh".tb_sgw_menu
          WHERE status = true
          ORDER BY nivel ASC, ordem ASC, id ASC`,
        {
          type: QueryTypes.SELECT
        }
      );

      const mapItens = new Map();

      for (const item of menus) {
        mapItens.set(item.id, {
          id: this._toInt(item.id, null),
          nome: item.nome,
          rota: item.rota || null,
          icone: item.icone || null,
          nivel: this._toInt(item.nivel, 0),
          id_menu_pai: this._toInt(item.id_menu_pai, 0),
          ordem: this._toInt(item.ordem, 0),
          status: Boolean(item.status),
          itens: []
        });
      }

      const raiz = [];

      for (const item of mapItens.values()) {
        const idPai = this._toInt(item.id_menu_pai, 0);
        const ehRaiz = item.nivel === 0 || !idPai;

        if (ehRaiz) {
          raiz.push(item);
          continue;
        }

        if (!mapItens.has(idPai)) {
          continue;
        }

        mapItens.get(idPai).itens.push(item);
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
      const status = true;
      const somenteAtivos = ['true', '1'].includes(String(status).trim().toLowerCase());

      const whereParts = ['1 = 1'];
      const replacements = {};

      if (somenteAtivos !== null) {
        whereParts.push('status = :status');
        replacements.status = somenteAtivos;
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
      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['1 = 1'];
      const replacements = {};

      const tipo = this._toInt(req.query.tipo, null);
      if (tipo !== null) {
        whereParts.push('dr.tipo = :tipo');
        replacements.tipo = tipo;
      }

      if (req.query.status !== undefined && String(req.query.status).trim() !== '') {
        whereParts.push('dr.status = :status');
        replacements.status = String(req.query.status).trim();
      }

      const exibicaoDashboard = this._toInt(req.query.exibicao_dashboard, null);
      if (exibicaoDashboard !== null) {
        whereParts.push('dr.exibicao_dashboard = :exibicao_dashboard');
        replacements.exibicao_dashboard = exibicaoDashboard;
      }

      if (req.query.origem !== undefined && String(req.query.origem).trim() !== '') {
        whereParts.push('dr.origem = :origem');
        replacements.origem = String(req.query.origem).trim();
      }

      if (req.query.q !== undefined && String(req.query.q).trim() !== '') {
        whereParts.push('(dr.titulo ILIKE :q OR dr.descricao ILIKE :q)');
        replacements.q = `%${String(req.query.q).trim()}%`;
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
            dr.created_at,
            dr.updated_at
          FROM "condominio-bh".tb_dashboard_registro dr
          LEFT JOIN "condominio-bh".tb_dashboard_tipo dt
             ON dt.id = dr.tipo
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

      return res.status(200).json({
        page,
        pageSize,
        total,
        totalPages,
        data
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
      const id = this._toInt(req.params.id, null);
      if (!id) {
        return res.status(400).json({ message: 'Id do registro inválido.' });
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
            dr.created_at,
            dr.updated_at
          FROM "condominio-bh".tb_dashboard_registro dr
          LEFT JOIN "condominio-bh".tb_dashboard_tipo dt
             ON dt.id = dr.tipo
          WHERE dr.id = :id
          LIMIT 1`,
        {
          replacements: { id },
          type: QueryTypes.SELECT
        }
      );

      if (!registro || registro.length === 0) {
        return res.status(404).json({ message: 'Registro de dashboard não encontrado.' });
      }

      return res.status(200).json({ data: registro[0] });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar registro do dashboard.',
        detail: error.message
      });
    }
  }

  async criarDashboardRegistro(req, res) {
    try {
      const idUsuarioToken = this._toInt(req.idcliente, null);

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
            now(),
            now()
        )
        RETURNING *`,
        {
          replacements: {
            tipo: this._toInt(req.body.tipo, 0),
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
            id_usuario: this._toInt(req.body.id_usuario, idUsuarioToken)
          }
        }
      );

      return res.status(201).json({
        message: 'Registro de dashboard criado com sucesso.',
        data: insert[0][0]
      });
    } catch (error) {
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
            id_usuario:
              req.body.id_usuario !== undefined
                ? this._toInt(req.body.id_usuario, null)
                : this._toInt(atual.id_usuario, null)
          }
        }
      );

      return res.status(200).json({
        message: 'Registro de dashboard atualizado com sucesso.',
        data: update[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao editar registro do dashboard.',
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

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 25), 1), 100);
      const offset = (page - 1) * pageSize;

      const totalRows = await postgres.query(
        `SELECT COUNT(*)::int AS total
           FROM "condominio-bh"."tb-usuarios" tu
          WHERE (
            :eh_admin = true
            OR (
              tu.id_condominio = :id_condominio
              AND COALESCE(tu.tipo_perfil_id::text, '0') <> '1'
            )
          )`,
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
            tu.nome,
            tu.sobrenome,
            tu.cpf,
            tu.email,
            tu.telefone,
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
          WHERE (
            :eh_admin = true
            OR (
              tu.id_condominio = :id_condominio
              AND COALESCE(tu.tipo_perfil_id::text, '0') <> '1'
            )
          )
          ORDER BY tu.id DESC
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
        data: rows
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao listar moradores no PostgreSQL',
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
        observacoes,
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
            now(),
            now()
        )
        RETURNING id, id_condominio, nome, sobrenome, cpf, email, telefone, tipo_morador, tipo_perfil_id, tipo, status, apartamento, bloco, created_at`,
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
            tipo: tipo || 'morador',
            status: status || 'ativo',
            senha_hash,
            endereco_logradouro: endereco_logradouro || null,
            endereco_numero: endereco_numero || null,
            endereco_complemento: endereco_complemento || null,
            endereco_bairro: endereco_bairro || null,
            endereco_cidade: endereco_cidade || null,
            endereco_uf: endereco_uf || null,
            endereco_cep: endereco_cep || null,
            apartamento: apartamento || null,
            bloco: bloco || null,
            observacoes: observacoes || null
          }
        }
      );

      return res.status(201).json({
        message: 'Usuário criado com sucesso.',
        data: insert[0][0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao criar usuário.',
        detail: error.message
      });
    }
  }

  async editarUsuario(req, res) {
    try {
      const idCondominioToken = this._toInt(req.id_condominio, null);
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
                observacoes = :observacoes,
                updated_at = now()
          WHERE id = :id
            AND id_condominio = :id_condominio
        RETURNING id, id_condominio, nome, sobrenome, cpf, email, telefone, tipo_morador, tipo_perfil_id, tipo, status, apartamento, bloco, created_at, updated_at`,
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
            tipo: req.body.tipo !== undefined ? req.body.tipo || 'morador' : atual.tipo,
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
            apartamento:
              req.body.apartamento !== undefined ? req.body.apartamento || null : atual.apartamento,
            bloco: req.body.bloco !== undefined ? req.body.bloco || null : atual.bloco,
            observacoes:
              req.body.observacoes !== undefined ? req.body.observacoes || null : atual.observacoes
          }
        }
      );

      return res.status(200).json({
        message: 'Usuário atualizado com sucesso.',
        data: update[0][0]
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
            id,
            id_condominio,
            nome,
            sobrenome,
            cpf,
            email,
            telefone,
            tipo_morador,
            data_nascimento,
            genero,
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
            observacoes,
            created_at,
            updated_at
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

      if (!usuario || usuario.length === 0) {
        return res.status(404).json({
          message: 'Usuário não encontrado para este condomínio.'
        });
      }

      return res.status(200).json({
        data: usuario[0]
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao buscar usuário.',
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
        taxa_reserva
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
            taxa_reserva: taxa_reserva || null
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
        taxa_reserva
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
            taxa_reserva: taxa_reserva || null
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
        `SELECT e.*, c.nome AS nome_condominio
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
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar reservas.'
        });
      }

      const hasPageParam = req.query.page !== undefined;
      const hasPageSizeParam = req.query.pageSize !== undefined;
      const usePagination = hasPageParam || hasPageSizeParam;

      const page = Math.max(this._toInt(req.query.page, 1), 1);
      const pageSize = Math.min(Math.max(this._toInt(req.query.pageSize, 10), 1), 100);
      const offset = (page - 1) * pageSize;

      const whereParts = ['ea.id_condominio = :idCondominio'];
      const baseReplacements = { idCondominio: idCondominioToken };

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
        statusList = [3, 4];
      }

      if (statusList.length === 1) {
        whereParts.push('(ea.status) = :status');
        baseReplacements.status = Number(statusList[0]);
      } else if (statusList.length > 1) {
        whereParts.push('(ea.status) IN (:status_list)');
        baseReplacements.status_list = statusList.map((item) => Number(item));
      }

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

        baseReplacements.data_inicio = dataInicio.toISOString().slice(0, 10);
        baseReplacements.data_fim = dataFim.toISOString().slice(0, 10);
        whereParts.push('ea.data_agendamento::date BETWEEN :data_inicio AND :data_fim');

        if (!req.query.status && !aba) {
          whereParts.push('(ea.status) IN (1, 2, 3, 4)');
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
            tu.apartamento,
            tu.bloco,
			      ea.*,
            e.nome AS espaco_nome,
            e.localizacao AS espaco_localizacao,
            e.taxa_reserva,
            tt.descricao_status 
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_espaco e
             ON e.id = ea.id_espaco
          inner join  "condominio-bh"."tb-usuarios" tu 
            on ea.id_usuario = tu.id
          inner join  "condominio-bh"."tb_status_tratamento" tt
            on ea.status = tt.id    
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
        : data.map((row) => ({
            ...row,
            nome: '****',
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
      const idCondominioToken = this._toInt(req.id_condominio, null);
      if (!idCondominioToken) {
        return res.status(403).json({
          message: 'Token sem id_condominio para listar reservas do mês corrente.'
        });
      }

      const data = await postgres.query(
        `SELECT
            tu.nome AS nome_usuario,
          e.nome AS sala,
            tu.apartamento,
            tu.bloco,
            tt.descricao_status AS status_reserva,
            ea.data_agendamento::date AS data_reserva
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_espaco e
             ON e.id = ea.id_espaco
          INNER JOIN "condominio-bh"."tb-usuarios" tu
             ON tu.id = ea.id_usuario
           LEFT JOIN "condominio-bh".tb_status_tratamento tt
             ON tt.id = ea.status
          WHERE ea.id_condominio = :idCondominio
          ORDER BY ea.data_agendamento::date ASC, ea.id ASC`,
        {
          replacements: { idCondominio: idCondominioToken },
          type: QueryTypes.SELECT
        }
      );

      const podeVisualizarDadosMorador = await this._podeVisualizarDadosMorador(req);
      const dataResposta = podeVisualizarDadosMorador
        ? data
        : data.map((row) => ({
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
        statusList = [3, 4];
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
            e.nome AS espaco_nome,
            e.localizacao AS espaco_localizacao,
            tt.descricao_status 
          FROM "condominio-bh".tb_espaco_agenda ea
          INNER JOIN "condominio-bh".tb_espaco e
             ON e.id = ea.id_espaco
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

      const idEspaco = this._toInt(req.params.id ?? req.body.id_espaco, null);
      if (!idEspaco) {
        return res.status(400).json({ message: 'Id do espaço inválido.' });
      }

      const espaco = await postgres.query(
        `SELECT id, periodo_modo
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

      const reservasMesmoDia = await postgres.query(
        `SELECT id, status, periodo_manha, periodo_tarde, periodo_noite, modo_sala
           FROM "condominio-bh".tb_espaco_agenda
          WHERE id_condominio = :id_condominio
            AND id_espaco = :id_espaco
            AND data_agendamento >= :data_agendamento_inicio
            AND data_agendamento < :data_agendamento_fim
            AND status IN (1, 2, 3, 4)`,
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
              id_usuario: idUsuarioToken,
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

        await transaction.commit();
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
      }

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

      const statusExists = await postgres.query(
        `SELECT id
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
          message: 'status_code inválido para tb_status_tratamento.'
        });
      }

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

        await transaction.commit();
      } catch (transactionError) {
        await transaction.rollback();
        throw transactionError;
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