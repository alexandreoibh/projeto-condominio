'use strict';

const schema = 'geral'
const tableName = 'tb_pastas_uploads'

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
        nivel: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        id_pai: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        nome_pasta: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        privacidade: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        pk_id_tb_documentos_modulo: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        pk_id_tb_modulo: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        status: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 'Active',
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
          defaultValue: Sequelize.literal("(now() at time zone 'utc')"),
        },
        created_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(now() at time zone 'utc')"),
        },
      },
    )
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable({ schema, tableName })
  },
}
