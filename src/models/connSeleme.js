const { Model, DataTypes } = require('sequelize');

class ConnSeleme extends Model {
  static init(sequelize) {
    return super.init(
      {
        Nome: DataTypes.STRING,
        Email: DataTypes.STRING,
      },
      {
        sequelize,
        modelName: 'ConnSeleme',
        tableName: 'tb_usuario', // ajuste conforme a sua tabela real
      }
    );
  }
}

module.exports = ConnSeleme;
