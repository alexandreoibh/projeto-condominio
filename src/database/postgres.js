const Sequelize = require('sequelize');
const config = require('./config_postgres');

const postgres = new Sequelize(config);

module.exports = postgres;