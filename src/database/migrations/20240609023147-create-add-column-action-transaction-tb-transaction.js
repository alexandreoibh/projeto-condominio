'use strict';
const schema = 'projeto';
const tableName = 'tb_transactions';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'action_transaction', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'action_transaction');
	},
}