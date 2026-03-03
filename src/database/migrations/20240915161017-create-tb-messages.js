'use strict';

const schema = 'chat'
const tableName = 'tb_messages'

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
        conversation_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        sender_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        content: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        message_type : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        media_url : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        file_name : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        file_size : {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        sent_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        created_at_id_user: {
          type: Sequelize.INTEGER,
          allowNull: true,
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
