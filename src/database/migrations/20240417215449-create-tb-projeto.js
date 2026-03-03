'use strict';

const schema = 'projeto'
const tableName = 'tb_projeto'

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
        project_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        status_project: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        status_project_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        contract_type: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        contract_type_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        permit: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        project_type: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        parcel_id: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        alt_key: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        project_type_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        customer: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        customer_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        adress: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        city: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        city_id: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        state: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        state_id: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        zip_code: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        complement: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        date_start: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        actual_start: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        date_end: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        actual_end: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        project_manager: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        internal_users: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        square_feet: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        qty: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        project_manager: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        internal_users: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        square_feet: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        qty: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        subs_vendors: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        contract_price: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        permit: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        subs_labor: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        supplies_material: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        delivery: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        referral_per: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        others: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        notes: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        notes_attachments: {
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
