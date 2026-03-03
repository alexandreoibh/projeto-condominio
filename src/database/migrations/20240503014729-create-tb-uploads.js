'use strict';

const schema = 'geral'
const tableName = 'tb_uploads'

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
        id_pk_pasta : {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        modulo   : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        imgbytes   : {
          type: Sequelize.BLOB,
        },
        arquivo: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 1,
        },
        id_user : {
          type: Sequelize.INTEGER,
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
