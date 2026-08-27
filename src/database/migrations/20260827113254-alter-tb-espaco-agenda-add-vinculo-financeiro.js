'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_espaco_agenda' AND column_name = 'id_receita_gerada'
        ) THEN
          ALTER TABLE "condominio-bh".tb_espaco_agenda ADD COLUMN id_receita_gerada BIGINT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_espaco_agenda' AND column_name = 'id_despesa_gerada'
        ) THEN
          ALTER TABLE "condominio-bh".tb_espaco_agenda ADD COLUMN id_despesa_gerada BIGINT;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_espaco_agenda DROP COLUMN IF EXISTS id_receita_gerada;
      ALTER TABLE "condominio-bh".tb_espaco_agenda DROP COLUMN IF EXISTS id_despesa_gerada;
    `);
  }
};
