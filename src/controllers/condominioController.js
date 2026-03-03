const postgres = require('../database/postgres');

class CondominioController {
  async status(req, res) {
    return res.status(200).json({
      module: 'condominio',
      status: 'ok'
    });
  }

  async listarMoradores(req, res) {
    try {
      const limit = Number(req.query.limit || 50);
      const [rows] = await postgres.query(
        `SELECT id, matricula, nome, email, telefone, id_perfil, status, id_empresa
         FROM sgw.tb_usuario
         ORDER BY id DESC
         LIMIT :limit`,
        {
          replacements: { limit: Number.isNaN(limit) ? 50 : limit }
        }
      );

      return res.status(200).json({
        total: rows.length,
        data: rows
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Falha ao listar moradores no PostgreSQL',
        detail: error.message
      });
    }
  }
}

module.exports = CondominioController;