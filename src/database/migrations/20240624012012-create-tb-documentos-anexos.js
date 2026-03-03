'use strict';

const schema = 'geral'
const tableName = 'tb_documentos_anexos'

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
        pk_id_tb_documentos: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        pk_id_origem: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        anexo: {
          type: Sequelize.BLOB,
          allowNull: true,
        },
        originalname: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 1,
        },
        mimetype: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 1,
        },
        filename: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 1,
        },
        size: {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: 1,
        },
        status: {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: 1,
        },
        due_date_document: {
          allowNull: true,
          type: Sequelize.DATE,
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
