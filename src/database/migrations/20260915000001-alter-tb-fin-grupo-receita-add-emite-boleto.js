'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_fin_grupo_receita' AND column_name = 'emite_boleto_bancario'
        ) THEN
          ALTER TABLE "condominio-bh".tb_fin_grupo_receita ADD COLUMN emite_boleto_bancario BOOLEAN NOT NULL DEFAULT false;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_fin_grupo_receita DROP COLUMN IF EXISTS emite_boleto_bancario;
    `);
  }
};
