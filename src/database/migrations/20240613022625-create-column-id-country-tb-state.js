'use strict';
const schema = 'geral';
const tableName = 'tb_state';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'id_country', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'id_country');
	},
}