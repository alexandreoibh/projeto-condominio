const { Model, DataTypes } = require('sequelize');

class Usuario extends Model {
    static init(sequelize) {
        super.init({
            matricula: DataTypes.STRING,
            nome: DataTypes.STRING,
            last_name: DataTypes.STRING,
            email: DataTypes.STRING,
            regional_gv: DataTypes.STRING,
            format_phone: DataTypes.STRING,
            telefone: DataTypes.STRING,
            address: DataTypes.STRING,
            cpf: DataTypes.STRING,
            id_perfil: DataTypes.NUMBER,
            data_nascimento: DataTypes.DATE,
            data_cadastro: DataTypes.DATE,
            status: DataTypes.NUMBER,
            id_empresa: DataTypes.NUMBER,
            country: DataTypes.STRING,
            uf_usu: DataTypes.STRING,
            cidade_usu: DataTypes.STRING,
            zip_code: DataTypes.STRING,
            senha: DataTypes.STRING,
            img: DataTypes.STRING,
            imgb: DataTypes.BLOB,
            last_online: DataTypes.DATE,
            duas_etapas: DataTypes.NUMBER,
            duas_etapas_value: DataTypes.STRING,
            duas_etapas_time: DataTypes.DATE,
            theme: DataTypes.STRING,
            idioma: DataTypes.STRING,
            update_at: DataTypes.DATE,
            update_at_id_user: DataTypes.NUMBER,
            created_at_id_user: DataTypes.NUMBER,
            created_at: DataTypes.DATE,
            socket_id:DataTypes.STRING,
        },
            {
                sequelize,
                schema: "sgw",
                tableName: "tb_usuario",
                timestamps: false
            });
    }
}

module.exports = Usuario;