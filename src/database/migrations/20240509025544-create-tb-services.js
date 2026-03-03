'use strict';

const schema = 'projeto'
const tableName = 'tb_services'

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
        pk_id_projeto: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        service_name: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        priority_service: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        priority_service_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        service_type: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        service_type_number: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        notes_service: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        date_start_service: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        date_end_service: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        actual_start_service: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        actual_end_service: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        square_feet_service: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        qty_service: {
          type: Sequelize.INTEGER,
          allowNull: true,
       },
        subs_vendors: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        specializations: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        price_service_specializations: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        cost_type: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        description_service: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        contract_price_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        permit_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        subs_labor_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        supplies_material_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        delivery_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        referral_per_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        others_service: {
          type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        notes_service_end: {
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
