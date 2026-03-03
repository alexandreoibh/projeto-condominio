module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query(`
    CREATE schema vendas`)
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query('DROP schema vendas')
  },
}
