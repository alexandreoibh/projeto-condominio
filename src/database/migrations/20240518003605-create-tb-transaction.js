'use strict';

const schema = 'projeto'
const tableName = 'tb_transactions'

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
        type_transaction: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        type_equity: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        sub_type_equity: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        pk_id_projeto: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        pk_id_projeto_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        pk_id_service: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        pk_id_service_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        date_transaction: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        date_due: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        date_effective: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        category_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        category: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        payment_status: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 'Pending',
        },
        payment_status_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
          defaultValue: 1,
        },
        type_payee: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        subs_vendors_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        subs_vendors: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        customer_id: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        customer: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        amount: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        parcial_payment: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        payment_method: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        method_information: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        account: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        split: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        reference_information: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        notes: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        upload: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        id_pasta: {
          type: Sequelize.INTEGER,
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
