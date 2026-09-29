'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Regras de cobrança por atraso enviadas ao banco na emissão do boleto
    // (hoje só Inter: objetos `multa`/`mora` do POST /cobranca/v3/cobrancas).
    // NULL/0 = não envia — comportamento anterior, boleto sem multa/juros.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_fin_integracao_bancaria' AND column_name = 'multa_percentual'
        ) THEN
          ALTER TABLE "condominio-bh".tb_fin_integracao_bancaria ADD COLUMN multa_percentual NUMERIC(5,2) NULL;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_fin_integracao_bancaria' AND column_name = 'juros_mora_percentual_mes'
        ) THEN
          ALTER TABLE "condominio-bh".tb_fin_integracao_bancaria ADD COLUMN juros_mora_percentual_mes NUMERIC(5,2) NULL;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_fin_integracao_bancaria DROP COLUMN IF EXISTS juros_mora_percentual_mes;
      ALTER TABLE "condominio-bh".tb_fin_integracao_bancaria DROP COLUMN IF EXISTS multa_percentual;
    `);
  }
};
