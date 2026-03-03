'use strict';
const schema = 'geral';
const tableName = 'tb_uploads';

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn({ schema, tableName }, 'size_file', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

	down: queryInterface => {
		return queryInterface.removeColumn({ schema, tableName }, 'size_file');
	},
}