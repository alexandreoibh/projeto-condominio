'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_fin_integracao_bancaria (
        id                      SERIAL PRIMARY KEY,
        id_condominio           INTEGER      NOT NULL,
        provider                VARCHAR(30)  NOT NULL,
        ambiente                VARCHAR(20)  NOT NULL DEFAULT 'production',
        client_id               VARCHAR(255) NOT NULL,
        client_secret_cifrado   TEXT         NOT NULL,
        certificado_cifrado     TEXT,
        chave_privada_cifrada   TEXT,
        conta_corrente          VARCHAR(30),
        agencia                 VARCHAR(20),
        chave_pix               VARCHAR(140),
        status_conexao          VARCHAR(20)  NOT NULL DEFAULT 'pendente',
        ultimo_erro             TEXT,
        ultima_verificacao_em   TIMESTAMPTZ,
        access_token_cifrado    TEXT,
        access_token_expira_em  TIMESTAMPTZ,
        id_usuario_cadastro     INTEGER,
        ativo                   BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Postgres de produção está na 9.2 (EOL) — sem "CREATE INDEX IF NOT EXISTS"
    // (só a partir do 9.5), por isso a checagem manual via pg_indexes abaixo.
    const [indiceCondominio] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_fin_integracao_bancaria_condominio'
    `);
    if (indiceCondominio.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_fin_integracao_bancaria_condominio
          ON "condominio-bh".tb_fin_integracao_bancaria (id_condominio, provider, ambiente);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_fin_integracao_bancaria;
    `);
  }
};
