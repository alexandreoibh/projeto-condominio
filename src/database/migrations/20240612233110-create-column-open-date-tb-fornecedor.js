'use strict';
const schema = 'fornecedor';
const tableName = 'tb_fornecedor';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'opening_date', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'opening_date');
	},
}