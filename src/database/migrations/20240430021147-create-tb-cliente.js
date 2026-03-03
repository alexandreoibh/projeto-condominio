'use strict';

const schema = 'cliente'
const tableName = 'tb_cliente'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { schema, tableName },
      {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        title: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        first_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        middle_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        last_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        sufix: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        company_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        document_number: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        customer_display_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        email: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        phone_number: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        mobile_number: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        fax: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        other: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        web_site: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        name_print: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        street_adress_1: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        street_adress_2: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        city: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        state: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        zip_code: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        country: {
          type: Sequelize.STRING,
          allowNull: true,
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
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
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
