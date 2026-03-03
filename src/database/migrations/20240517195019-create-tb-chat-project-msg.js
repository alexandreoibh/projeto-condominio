'use strict';

const schema = 'geral'
const tableName = 'tb_chat_projetos_msg'

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
        pk_id_chat_origem: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
         tipo_chat: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        avatar: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        text: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        from: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        time: {
          type: Sequelize.STRING,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        msg_type: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        status: {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: 1,
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
