'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_fin_documentos_competencia (
        id                   SERIAL PRIMARY KEY,
        id_condominio        INTEGER      NOT NULL,
        competencia          DATE         NOT NULL,
        tipo                 VARCHAR(30)  NOT NULL,
        nome_arquivo         VARCHAR(255) NOT NULL,
        caminho_arquivo      TEXT         NOT NULL,
        id_usuario_cadastro  INTEGER,
        data_envio           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Postgres de produção está na 9.2 (EOL) — sem "CREATE INDEX IF NOT EXISTS"
    // (só a partir do 9.5), por isso a checagem manual via pg_indexes abaixo.
    const [indiceExistente] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_fin_documentos_competencia_condominio_periodo'
    `);
    if (indiceExistente.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_fin_documentos_competencia_condominio_periodo
          ON "condominio-bh".tb_fin_documentos_competencia (id_condominio, competencia);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_fin_documentos_competencia;
    `);
  }
};
