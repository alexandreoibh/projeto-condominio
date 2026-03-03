'use strict';
const schema = 'cliente';
const tableName = 'tb_cliente';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'format_phone', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'format_phone');
	},
}