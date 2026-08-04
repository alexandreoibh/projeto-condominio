'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_telegram_vinculo_codigos (
        id             SERIAL PRIMARY KEY,
        codigo         VARCHAR(32) NOT NULL UNIQUE,
        id_usuario     INTEGER NOT NULL,
        id_condominio  INTEGER NOT NULL,
        expira_em      TIMESTAMPTZ NOT NULL,
        usado_em       TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_telegram_vinculo_codigos;
    `);
  }
};
