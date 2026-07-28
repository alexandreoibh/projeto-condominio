'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_fin_2via_boleto_log (
        id                     SERIAL PRIMARY KEY,
        id_condominio          INTEGER     NOT NULL,
        id_receita             INTEGER     NOT NULL,
        id_usuario_solicitante INTEGER,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // O servidor PostgreSQL de produção está na versão 9.2 (EOL), que não
    // suporta "CREATE INDEX IF NOT EXISTS" (só a partir do 9.5) — ver
    // README.md, seção sobre incompatibilidades de sintaxe com Postgres 9.2.
    const [indiceExistente] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_fin_2via_boleto_log_receita'
    `);
    if (indiceExistente.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_fin_2via_boleto_log_receita
          ON "condominio-bh".tb_fin_2via_boleto_log (id_receita, created_at);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_fin_2via_boleto_log;
    `);
  }
};
