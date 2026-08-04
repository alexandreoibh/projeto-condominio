'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_mensagens_fila (
        id                    SERIAL PRIMARY KEY,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        id_condominio         INTEGER NOT NULL,
        id_usuario_criacao    INTEGER,
        id_usuario_destino    INTEGER,
        tipo                  VARCHAR(20) NOT NULL CHECK (tipo IN ('whatsapp', 'telegram')),
        mensagem_bruta        VARCHAR(2000) NOT NULL,
        mensagem_tratada_ia   TEXT,
        modulo                VARCHAR(100),
        data_cron_execucao    TIMESTAMPTZ,
        status                INTEGER NOT NULL DEFAULT 1,
        falha                 VARCHAR(800)
      );
    `);

    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'condominio-bh' AND indexname = 'idx_mensagens_fila_status'
        ) THEN
          CREATE INDEX idx_mensagens_fila_status ON "condominio-bh".tb_mensagens_fila (status);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_mensagens_fila;
    `);
  }
};
