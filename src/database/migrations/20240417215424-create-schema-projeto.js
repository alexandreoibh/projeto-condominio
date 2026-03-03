module.exports = {
  up: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query(`
    CREATE schema projeto`)
  },

  down: async (queryInterface, Sequelize) => {
    return queryInterface.sequelize.query('DROP schema projeto')
  },
}
