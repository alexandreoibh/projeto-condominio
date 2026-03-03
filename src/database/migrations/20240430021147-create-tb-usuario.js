'use strict';

const schema = 'sgw'
const tableName = 'tb_usuario'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { schema, tableName },
      {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false,
        },
        matricula: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        nome: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        email: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        regional_gv: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        cpf: {
          type: Sequelize.STRING,
          allowNull: true,
        },
         telefone: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        id_perfil: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        data_nascimento: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        data_cadastro: {
          type: Sequelize.DATE,
          allowNull: true,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        status: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        id_empresa: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        uf_usu: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        cidade_usu: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        senha: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        img: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        last_online: {
          type: Sequelize.DATE,
          allowNull: true,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        duas_etapas: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        duas_etapas_value: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        duas_etapas_time: {
          type: Sequelize.DATE,
          allowNull: true,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        imgb: {
          type: Sequelize.BLOB,
          allowNull: true,
        },
        theme: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        idioma: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        created_at_id_user: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        update_at_id_user: {
          type: Sequelize.INTEGER,
          allowNull: true,
        },
        update_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
        created_at: {
          allowNull: true,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("(CURRENT_TIMESTAMP AT TIME ZONE 'utc')"),
        },
      },
    )
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable({ schema, tableName })
  },
}
