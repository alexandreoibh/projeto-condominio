'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_fin_receitas_documentos (
        id                   SERIAL PRIMARY KEY,
        id_receita           INTEGER      NOT NULL,
        tipo                 VARCHAR(30)  NOT NULL,
        nome_arquivo         VARCHAR(255) NOT NULL,
        caminho_arquivo      TEXT         NOT NULL,
        id_usuario_cadastro  INTEGER,
        data_envio           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // O servidor PostgreSQL de produção está na versão 9.2 (EOL), que não
    // suporta "CREATE INDEX IF NOT EXISTS" (só a partir do 9.5) — ver
    // README.md, seção sobre incompatibilidades de sintaxe com Postgres 9.2.
    const [indiceExistente] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_fin_receitas_documentos_receita'
    `);
    if (indiceExistente.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_fin_receitas_documentos_receita
          ON "condominio-bh".tb_fin_receitas_documentos (id_receita);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_fin_receitas_documentos;
    `);
  }
};
