'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_fin_cobranca_bancaria (
        id                      SERIAL PRIMARY KEY,
        id_condominio           INTEGER      NOT NULL,
        id_receita              INTEGER      NOT NULL,
        id_integracao_bancaria  INTEGER      NOT NULL,
        provider                VARCHAR(30)  NOT NULL,
        tipo_cobranca           VARCHAR(20)  NOT NULL DEFAULT 'boleto',
        situacao                VARCHAR(30)  NOT NULL DEFAULT 'emitida',
        id_externo              VARCHAR(120) NOT NULL,
        nosso_numero            VARCHAR(30),
        linha_digitavel         VARCHAR(64),
        codigo_barras           VARCHAR(64),
        pix_copia_cola          TEXT,
        qr_code_base64          TEXT,
        url_pdf                 TEXT,
        valor                   NUMERIC(12,2) NOT NULL,
        data_emissao            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        data_vencimento         DATE         NOT NULL,
        data_pagamento          TIMESTAMPTZ,
        valor_pago              NUMERIC(12,2),
        payload_emissao         TEXT,
        payload_resposta        TEXT,
        id_usuario_solicitante  INTEGER,
        created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // Postgres de produção está na 9.2 (EOL) — sem "CREATE INDEX IF NOT EXISTS"
    // (só a partir do 9.5), por isso a checagem manual via pg_indexes abaixo.
    const [indiceReceita] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_fin_cobranca_bancaria_receita'
    `);
    if (indiceReceita.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_fin_cobranca_bancaria_receita
          ON "condominio-bh".tb_fin_cobranca_bancaria (id_receita);
      `);
    }

    const [indiceExterno] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_fin_cobranca_bancaria_externo'
    `);
    if (indiceExterno.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_fin_cobranca_bancaria_externo
          ON "condominio-bh".tb_fin_cobranca_bancaria (provider, id_externo);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_fin_cobranca_bancaria;
    `);
  }
};
