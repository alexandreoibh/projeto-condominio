'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_manutencao_rotina (
        id_rotina_manutencao SERIAL PRIMARY KEY,
        id_condominio        INTEGER NOT NULL,
        id_tipo_rotina       INTEGER NOT NULL,
        id_fornecedor        INTEGER,
        nome_rotina          VARCHAR(150) NOT NULL,
        descricao            TEXT,
        local_rotina         VARCHAR(150),
        frequencia           VARCHAR(20) NOT NULL CHECK (frequencia IN ('DIARIA','SEMANAL','QUINZENAL','MENSAL','BIMESTRAL','TRIMESTRAL','SEMESTRAL','ANUAL')),
        intervalo_execucao   INTEGER NOT NULL DEFAULT 1,
        unidade_tempo        VARCHAR(10) NOT NULL DEFAULT 'MES' CHECK (unidade_tempo IN ('DIA','SEMANA','MES','ANO')),
        data_inicio          DATE NOT NULL,
        proxima_execucao     DATE NOT NULL,
        ultima_execucao      DATE,
        custo_estimado       NUMERIC(10,2) DEFAULT 0.00,
        ativo                CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S','N')),
        status_rotina        VARCHAR(20) NOT NULL DEFAULT 'EM_DIA' CHECK (status_rotina IN ('EM_DIA','PENDENTE','ATRASADA','EM_EXECUCAO','CONCLUIDA','CANCELADA')),
        observacao           TEXT,
        criado_por           INTEGER,
        data_criacao         TIMESTAMP NOT NULL DEFAULT NOW(),
        atualizado_por       INTEGER,
        data_atualizacao     TIMESTAMP DEFAULT NOW()
      );

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
           WHERE schemaname = 'condominio-bh' AND indexname = 'idx_manutencao_rotina_condominio'
        ) THEN
          CREATE INDEX idx_manutencao_rotina_condominio
            ON "condominio-bh".tb_manutencao_rotina (id_condominio);
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_manutencao_rotina;
    `);
  }
};
