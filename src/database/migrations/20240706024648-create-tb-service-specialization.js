'use strict';

const schema = 'projeto'
const tableName = 'tb_services_especialization'

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
        id_service: {
          type: Sequelize.INTEGER,
          allowNull: false,
        },
        subs_vendors : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        specializations   : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        price_service   : {
         type: Sequelize.DECIMAL(18, 2),
          allowNull: true,
        },
        cost_type   : {
          type: Sequelize.STRING,
          allowNull: true,
        },
        description_service   : {
          type: Sequelize.STRING,
          allowNull: true,
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
