'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_recovery_tokens (
        id           SERIAL PRIMARY KEY,
        id_usuario   INTEGER      NOT NULL,
        id_condominio INTEGER     NOT NULL,
        code_hash    VARCHAR(255) NOT NULL,
        invite_token TEXT         NOT NULL,
        expires_at   TIMESTAMPTZ  NOT NULL,
        attempts     INTEGER      NOT NULL DEFAULT 0,
        consumed_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_recovery_tokens_usuario_expires
        ON "condominio-bh".tb_recovery_tokens (id_usuario, expires_at);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS "condominio-bh".tb_recovery_tokens;
    `);
  }
};
