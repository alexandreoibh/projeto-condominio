'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_fin_meta_fundo_reserva (
        id             SERIAL PRIMARY KEY,
        id_condominio  INTEGER NOT NULL UNIQUE,
        valor_meta     NUMERIC(14,2) NOT NULL,
        atualizado_por INTEGER,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_fin_meta_fundo_reserva;
    `);
  }
};
