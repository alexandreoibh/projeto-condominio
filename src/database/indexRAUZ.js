const Sequelize = require('sequelize');
const config = require('./config');
const requireDir = require('require-dir');
const path = require('path');

const models = requireDir('../models',{
    filter:fullPatch=>{ 
        return path.basename(fullPatch)
    }   
});
this.connection = new Sequelize(config);

Object.values(models)
.filter(model=>model.init)
.map(model=>model
.init(this.connection));

module.exports = this.connection;