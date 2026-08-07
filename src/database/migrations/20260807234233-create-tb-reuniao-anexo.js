'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_reuniao_anexo (
        id                   SERIAL PRIMARY KEY,
        id_reuniao           INTEGER      NOT NULL,
        tipo                 VARCHAR(30)  NOT NULL,
        nome_arquivo         VARCHAR(255) NOT NULL,
        caminho_arquivo      TEXT         NOT NULL,
        id_usuario_cadastro  INTEGER,
        data_envio           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
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
      DROP TABLE IF EXISTS "condominio-bh".tb_reuniao_anexo;
    `);
  }
};
