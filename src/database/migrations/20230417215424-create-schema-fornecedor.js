module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query(`
    CREATE schema fornecedor`)
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query('DROP schema fornecedor')
  },
}
