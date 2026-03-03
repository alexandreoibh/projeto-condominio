const ConnSisvenda = require('./connSisvenda');
const ConnSeleme = require('./connSeleme');
const { db1, db2 } = require('../database');

// Modelos que usam o banco SISVENDA
ConnSisvenda.init(db1);

// Modelos que usam o banco SELEME
ConnSeleme.init(db2);

module.exports = {
  ConnSisvenda,
  ConnSeleme,
};

