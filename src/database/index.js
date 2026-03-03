// src/database/index.js
const Sequelize = require('sequelize');
const config = require('./config');

const db1 = new Sequelize(config.db1);
const db2 = new Sequelize(config.db2);

module.exports = { db1, db2 };
