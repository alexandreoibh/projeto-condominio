'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Controle de "no máximo 1 e-mail receita_cobranca_morador por receita"
    // (criação, reemissão manual, edição e rotina mensal disputam o envio —
    // _enviarEmailCobrancaReceita reserva atomicamente com
    // UPDATE ... WHERE email_cobranca_enviado_em IS NULL).
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_fin_receitas' AND column_name = 'email_cobranca_enviado_em'
        ) THEN
          ALTER TABLE "condominio-bh".tb_fin_receitas ADD COLUMN email_cobranca_enviado_em TIMESTAMPTZ NULL;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_fin_receitas DROP COLUMN IF EXISTS email_cobranca_enviado_em;
    `);
  }
};
