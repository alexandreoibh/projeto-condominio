'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_manutencao_tipo_rotina (
        id_tipo_rotina SERIAL PRIMARY KEY,
        nome_tipo      VARCHAR(100) NOT NULL,
        descricao      VARCHAR(255),
        ativo          CHAR(1) NOT NULL DEFAULT 'S' CHECK (ativo IN ('S','N'))
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_manutencao_tipo_rotina;
    `);
  }
};
