'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_manutencao_execucao_log (
        id_execucao_rotina    SERIAL PRIMARY KEY,
        id_rotina_manutencao  INTEGER NOT NULL,
        data_execucao         DATE NOT NULL,
        data_proxima_execucao DATE,
        status_execucao       VARCHAR(20) NOT NULL DEFAULT 'CONCLUIDA' CHECK (status_execucao IN ('CONCLUIDA','PENDENTE','ATRASADA','EM_EXECUCAO','CANCELADA')),
        custo_real            NUMERIC(10,2) DEFAULT 0.00,
        observacao_execucao   TEXT,
        anexo_execucao        VARCHAR(255),
        executado_por         INTEGER,
        data_registro         TIMESTAMP NOT NULL DEFAULT NOW()
      );

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'condominio-bh' AND indexname = 'idx_execucao_data'
        ) THEN
          CREATE INDEX idx_execucao_data
            ON "condominio-bh".tb_manutencao_execucao_log (data_execucao);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'condominio-bh' AND indexname = 'idx_execucao_rotina'
        ) THEN
          CREATE INDEX idx_execucao_rotina
            ON "condominio-bh".tb_manutencao_execucao_log (id_rotina_manutencao);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_manutencao_execucao_log;
    `);
  }
};
