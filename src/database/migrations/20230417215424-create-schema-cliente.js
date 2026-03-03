module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query(`
    CREATE schema cliente`)
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query('DROP schema cliente')
  },
}
