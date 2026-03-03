const { Model, DataTypes } = require('sequelize');

class ConnSisvenda extends Model {
    static init(sequelize) {
        return super.init(
            {
                Nome: DataTypes.STRING,
                Email: DataTypes.STRING,
            },
            {
                sequelize,
                modelName: 'ConnSisvenda',
                tableName: 'tb_usuario', // troque pelo nome real da tabela
                timestamps: false, // ou true se tiver createdAt / updatedAt
            }
        );
    }
}

module.exports = ConnSisvenda;
