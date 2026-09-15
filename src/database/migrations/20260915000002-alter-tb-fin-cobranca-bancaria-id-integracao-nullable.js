'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Registro de falha de emissão (situacao='erro') pode acontecer ANTES de
    // resolver qual integração bancária usar (ex: nenhuma integração ativa
    // para o condomínio) — nesse caso não há id_integracao_bancaria válido
    // para gravar. Torna a coluna nullable para suportar esse caso; toda
    // linha com situacao != 'erro' continua sempre preenchendo esse campo.
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_fin_cobranca_bancaria
        ALTER COLUMN id_integracao_bancaria DROP NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_fin_cobranca_bancaria
        ALTER COLUMN id_integracao_bancaria SET NOT NULL;
    `);
  }
};
