const { Model, DataTypes } = require("sequelize");

class User extends Model {
  static init(sequelize) {
    super.init(
      {
        username: DataTypes.STRING,
        telefone_movel: DataTypes.STRING,
        telefone_fixo: DataTypes.STRING,
        data_nascimento: DataTypes.DATE,
        fk_id_user_assessor: DataTypes.INTEGER,
        apelido: DataTypes.STRING,
        email: DataTypes.STRING,
        codsmart:DataTypes.INTEGER,
        status: DataTypes.INTEGER,
        situacao_patrimonial:DataTypes.STRING,
        cpf: DataTypes.INTEGER,
        fk_id_user_approved: DataTypes.INTEGER,
        fk_id_perfil: DataTypes.INTEGER,
        fk_id_relacionamento: DataTypes.INTEGER,
        tipo_perfil_investidor:DataTypes.STRING,
        fk_id_user_approved:DataTypes.STRING,
        cod_plataforma_assessor:DataTypes.STRING,
        idcliente_ccnsystem:DataTypes.STRING,
        created_at: DataTypes.DATE,
        socket_id:DataTypes.STRING,
      },
      {
        sequelize,
        tableName: "user_users",
        timestamps: false,
      }
    );
  }
}

module.exports = User;
