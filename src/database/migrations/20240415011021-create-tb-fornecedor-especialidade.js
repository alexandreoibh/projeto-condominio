'use strict';

const schema = 'fornecedor'
const tableName = 'tb_fornecedor_especialidade'

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
        pk_id_tb_fornecedor: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        vendor_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        professional: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        phone_number: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        email: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        license_number: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        exp_data_license: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        liability: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        work_compensation_licenses: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        exp_data_liability: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        exp_data_work_compensation: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        w9: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        id_user: {
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
