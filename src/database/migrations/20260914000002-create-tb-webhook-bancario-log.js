'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_webhook_bancario_log (
        id                    SERIAL PRIMARY KEY,
        provider              VARCHAR(30)  NOT NULL,
        id_condominio         INTEGER,
        evento_tipo           VARCHAR(60),
        id_externo            VARCHAR(120),
        payload_bruto         TEXT         NOT NULL,
        headers_recebidos     TEXT,
        ip_origem             VARCHAR(64),
        status_processamento  VARCHAR(20)  NOT NULL DEFAULT 'recebido',
        erro_detalhe          TEXT,
        recebido_em           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        processado_em         TIMESTAMPTZ
      );
    `);

    // Postgres de produção está na 9.2 (EOL) — sem "CREATE INDEX IF NOT EXISTS"
    // (só a partir do 9.5), por isso a checagem manual via pg_indexes abaixo.
    const [indiceExterno] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_webhook_bancario_log_externo'
    `);
    if (indiceExterno.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_webhook_bancario_log_externo
          ON "condominio-bh".tb_webhook_bancario_log (provider, id_externo);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_webhook_bancario_log;
    `);
  }
};
