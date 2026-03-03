'use strict';
const schema = 'sgw';
const tableName = 'tb_usuario';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'address', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'address');
	},
}