'use strict';

const schema = 'chat'
const tableName = 'tb_emojis'

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
        shortcode : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        emoji_unicode : {
          type: Sequelize.STRING,
          allowNull: true,
        },
      },
    )
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable({ schema, tableName })
  },
}
