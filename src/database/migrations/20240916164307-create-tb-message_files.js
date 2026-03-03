'use strict';

const schema = 'chat'
const tableName = 'tb_message_files'

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
        message_id : {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        file_name  : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        file_size  : {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        uploaded_at  : {
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
