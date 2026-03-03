'use strict';
const schema = 'fornecedor';
const tableName = 'tb_fornecedor';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'feilein_number', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'feilein_number');
	},
}