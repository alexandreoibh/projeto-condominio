module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query(`
    CREATE schema schedule`)
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query('DROP schema schedule')
  },
}
