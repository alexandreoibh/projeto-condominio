const postgres = require('../database/postgres');
const { QueryTypes } = require('sequelize');

class WhatsappController {
  async obterInstancia(req, res) {
    try {
      const rows = await postgres.query(
        `SELECT instance_name, status, telefone, nome_perfil, updated_at AS atualizado_em
           FROM "condominio-bh".tb_whatsapp_instancia
          WHERE id = 1`,
        { type: QueryTypes.SELECT }
      );

      if (!rows.length) {
        return res.status(200).json({ instancia: null });
      }

      return res.status(200).json({ instancia: rows[0] });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao obter instância do WhatsApp.',
        detail: error.message
      });
    }
  }

  async salvarInstancia(req, res) {
    try {
      const instanceName = String(req.body.instance_name || '').trim();
      const status = req.body.status;
      const telefone = req.body.telefone ? String(req.body.telefone).trim() : null;
      const nomePerfil = req.body.nome_perfil ? String(req.body.nome_perfil).trim() : null;

      const replacements = {
        instance_name: instanceName,
        status,
        telefone,
        nome_perfil: nomePerfil,
      };

      const [, updatedRows] = await postgres.query(
        `UPDATE "condominio-bh".tb_whatsapp_instancia
            SET instance_name = :instance_name,
                status = :status,
                telefone = :telefone,
                nome_perfil = :nome_perfil,
                updated_at = NOW()
          WHERE id = 1`,
        { replacements, type: QueryTypes.UPDATE }
      );

      if (updatedRows === 0) {
        await postgres.query(
          `INSERT INTO "condominio-bh".tb_whatsapp_instancia
             (id, instance_name, status, telefone, nome_perfil, created_at, updated_at)
           VALUES (1, :instance_name, :status, :telefone, :nome_perfil, NOW(), NOW())`,
          { replacements, type: QueryTypes.INSERT }
        );
      }

      return res.status(200).json({
        message: 'Instância do WhatsApp salva com sucesso.',
        instancia: {
          instance_name: instanceName,
          status,
          telefone,
          nome_perfil: nomePerfil,
        }
      });
    } catch (error) {
      return res.status(500).json({
        message: 'Falha ao salvar instância do WhatsApp.',
        detail: error.message
      });
    }
  }
}

module.exports = WhatsappController;
