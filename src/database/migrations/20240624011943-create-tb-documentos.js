'use strict';

const schema = 'geral'
const tableName = 'tb_documentos'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { schema, tableName },
      {
        id: {
          type: Sequelize.INTEGER,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        nome_documento: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        pk_id_tb_documentos_modulo: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        obrigatorio_documento: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        aviso_anexar_documento: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        obrigatorio_dt_vencimento: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        aviso_dt_vencimento: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        dt_vencimento: {
          allowNull: true,
          type: Sequelize.DATE,
        },
        status: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 1,
        },
        created_at_id_user: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        update_at_id_user: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        update_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        created_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
      },
    )
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable({ schema, tableName })
  },
}
