'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_whatsapp_instancia (
        id             SERIAL PRIMARY KEY,
        id_condominio  INTEGER NOT NULL UNIQUE,
        instance_name  VARCHAR NOT NULL,
        status         VARCHAR NOT NULL DEFAULT 'DESCONECTADO',
        telefone       VARCHAR,
        nome_perfil    VARCHAR,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_whatsapp_instancia;
    `);
  }
};
