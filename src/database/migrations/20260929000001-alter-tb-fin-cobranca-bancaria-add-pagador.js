'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Registra em nome de quem o boleto foi emitido (pagador resolvido por
    // _resolverPagadorBoleto: principal da unidade → id_usuario da receita →
    // outro morador ativo da unidade). Nullable: boletos anteriores a esta
    // migration e registros de falha (situacao='erro') não têm pagador.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_fin_cobranca_bancaria' AND column_name = 'id_usuario_pagador'
        ) THEN
          ALTER TABLE "condominio-bh".tb_fin_cobranca_bancaria ADD COLUMN id_usuario_pagador BIGINT NULL;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'condominio-bh' AND table_name = 'tb_fin_cobranca_bancaria' AND column_name = 'pagador_nome'
        ) THEN
          ALTER TABLE "condominio-bh".tb_fin_cobranca_bancaria ADD COLUMN pagador_nome VARCHAR(255) NULL;
        END IF;
      END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_fin_cobranca_bancaria DROP COLUMN IF EXISTS pagador_nome;
      ALTER TABLE "condominio-bh".tb_fin_cobranca_bancaria DROP COLUMN IF EXISTS id_usuario_pagador;
    `);
  }
};
