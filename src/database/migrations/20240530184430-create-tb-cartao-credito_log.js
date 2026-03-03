'use strict';

const schema = 'geral'
const tableName = 'tb_cartao_credito_log'

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
        nome: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        apelido: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        valor: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
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
