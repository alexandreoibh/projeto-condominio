'use strict';
const schema = 'fornecedor';
const tableName = 'tb_fornecedor';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'type_vendor', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'type_vendor');
	},
}