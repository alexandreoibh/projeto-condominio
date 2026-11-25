'use strict';

// Rate limit persistente da recuperação de senha (hardening 25/11/2026).
// Usado por src/helpers/rateLimit.js. Retenção de 48 h (limpeza em lotes pelo
// próprio backend). Sem dados pessoais: as chaves usam HMAC do login.
//
// Rodar ANTES do deploy: sem a tabela, a recuperação responde 503 (fail closed).
// Permissões mínimas do usuário da aplicação: ver o .sql equivalente
// (src/database/sql/20261125000001-tb-rate-limit.sql).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_rate_limit (
        chave          VARCHAR(200) NOT NULL,
        janela         TIMESTAMPTZ  NOT NULL,
        contador       INTEGER      NOT NULL DEFAULT 0 CHECK (contador >= 0),
        atualizado_em  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        PRIMARY KEY (chave, janela)
      );
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rate_limit_atualizado_em
          ON "condominio-bh".tb_rate_limit (atualizado_em);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "condominio-bh".tb_rate_limit;`);
  }
};
