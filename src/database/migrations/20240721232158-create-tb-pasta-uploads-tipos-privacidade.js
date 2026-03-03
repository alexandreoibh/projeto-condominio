'use strict';

const schema = 'geral'
const tableName = 'tb_pastas_uploads_privacidade_tipos'

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
        name_privacidade   : {
          type: Sequelize.STRING,
          allowNull: true,
        },
         icon : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        status : {
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
