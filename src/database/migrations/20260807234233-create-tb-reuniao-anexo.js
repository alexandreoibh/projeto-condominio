'use strict';

/**
 * A tabela "condominio-bh".tb_reuniao_anexo ja existia em producao antes desta
 * migration, com um schema diferente do assumido originalmente (colunas reais:
 * id, id_reuniao, id_ata, nome_arquivo, url, tipo, created_at - sem
 * caminho_arquivo/data_envio/id_usuario_cadastro/updated_at). O CREATE TABLE
 * IF NOT EXISTS anterior foi ignorado silenciosamente pelo Postgres. Esta
 * migration so garante o indice de consulta por id_reuniao, sem alterar o
 * schema existente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_reuniao_anexo'
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'condominio-bh' AND indexname = 'idx_reuniao_anexo_reuniao'
        ) THEN
          CREATE INDEX idx_reuniao_anexo_reuniao ON "condominio-bh".tb_reuniao_anexo (id_reuniao);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS "condominio-bh".idx_reuniao_anexo_reuniao;
    `);
  }
};
