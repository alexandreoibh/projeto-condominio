'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Histórico de criação/edição/exclusão de salas (tb_espaco). Sem FK para
    // tb_espaco de propósito: o log precisa sobreviver à exclusão da sala.
    // Campos JSON como TEXT (parse no Node) — mesmo padrão de payload_* em
    // tb_fin_cobranca_bancaria, sem depender de funções JSON do PG 9.2.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_espaco_log (
        id                BIGSERIAL    PRIMARY KEY,
        id_espaco         BIGINT       NOT NULL,
        id_condominio     BIGINT       NOT NULL,
        acao              VARCHAR(20)  NOT NULL,
        id_usuario        BIGINT       NULL,
        nome_usuario      VARCHAR(255) NULL,
        email_usuario     VARCHAR(255) NULL,
        perfil_usuario    VARCHAR(60)  NULL,
        campos_alterados  TEXT         NULL,
        dados_anteriores  TEXT         NULL,
        dados_novos       TEXT         NULL,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
      );
    `);

    const [indice] = await queryInterface.sequelize.query(`
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'condominio-bh'
         AND indexname = 'idx_espaco_log_espaco'
    `);
    if (indice.length === 0) {
      await queryInterface.sequelize.query(`
        CREATE INDEX idx_espaco_log_espaco
          ON "condominio-bh".tb_espaco_log (id_condominio, id_espaco, created_at);
      `);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_espaco_log;
    `);
  }
};
