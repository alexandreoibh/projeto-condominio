'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_manutencao_execucao_log' AND column_name = 'id_fornecedor'
        ) THEN
          ALTER TABLE "condominio-bh".tb_manutencao_execucao_log ADD COLUMN id_fornecedor INTEGER;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_manutencao_execucao_log' AND column_name = 'anexos_execucao'
        ) THEN
          ALTER TABLE "condominio-bh".tb_manutencao_execucao_log ADD COLUMN anexos_execucao TEXT;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_manutencao_execucao_log DROP COLUMN IF EXISTS id_fornecedor;
      ALTER TABLE "condominio-bh".tb_manutencao_execucao_log DROP COLUMN IF EXISTS anexos_execucao;
    `);
  }
};
