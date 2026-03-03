'use strict';

const schema = 'schedule'
const tableName = 'tb_schedule'

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
        title: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        assignees: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        color: {
          type: Sequelize.STRING,
          allowNull: true,
          defaultValue: 1,
        },
        start_date: {
          allowNull: true,
          type: Sequelize.DATE,
        },
        end_date: {
          allowNull: true,
          type: Sequelize.DATE,
        },
        work_days: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        progress: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        reminder: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        completed: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        notes: {
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
          defaultValue: Sequelize.literal("(now() at time zone 'utc')"),
        },
        created_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(now() at time zone 'utc')"),
        },
      },
    )
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable({ schema, tableName })
  },
}
