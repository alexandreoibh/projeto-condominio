'use strict';

// Hardening pós-incidente de 22/11/2026.
//
// 1. tb_recovery_tokens: o JWT de recuperação deixa de ser gravado (era
//    devolvido sem prova de identidade). Passa a existir um reset token opaco
//    de uso único, do qual só o sha256 é gravado. Os JWTs antigos gravados são
//    apagados (invite_token = NULL) e os desafios pendentes são encerrados.
// 2. "tb-usuarios".token_version: revogação de sessões (JWT claim `tv`).
// 3. tb_auditoria_seguranca: trilha de auditoria (senha, perfil, financeiro).
//
// Compatível com PostgreSQL 9.2 (sem ADD COLUMN IF NOT EXISTS / CREATE INDEX
// IF NOT EXISTS): checagens manuais em information_schema / pg_indexes.
//
// ANTES DE RODAR EM PRODUÇÃO: backup das tabelas afetadas, por exemplo
//   pg_dump -t '"condominio-bh".tb_recovery_tokens' -t '"condominio-bh"."tb-usuarios"' ...

async function _addColunaSeNaoExiste(queryInterface, tabela, coluna, definicao) {
  await queryInterface.sequelize.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'condominio-bh' AND table_name = '${tabela}' AND column_name = '${coluna}'
      ) THEN
        ALTER TABLE "condominio-bh"."${tabela}" ADD COLUMN ${coluna} ${definicao};
      END IF;
    END $$;
  `);
}

async function _criarIndiceSeNaoExiste(queryInterface, nome, ddl) {
  const [existente] = await queryInterface.sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname = '${nome}'`
  );
  if (existente.length === 0) {
    await queryInterface.sequelize.query(ddl);
  }
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // --- 1. tb_recovery_tokens ------------------------------------------------
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_recovery_tokens ALTER COLUMN invite_token DROP NOT NULL;
    `);
    await _addColunaSeNaoExiste(queryInterface, 'tb_recovery_tokens', 'reset_token_hash', 'VARCHAR(64) NULL');
    await _addColunaSeNaoExiste(queryInterface, 'tb_recovery_tokens', 'reset_expires_at', 'TIMESTAMPTZ NULL');
    await _addColunaSeNaoExiste(queryInterface, 'tb_recovery_tokens', 'reset_used_at', 'TIMESTAMPTZ NULL');
    await _addColunaSeNaoExiste(queryInterface, 'tb_recovery_tokens', 'request_ip', 'VARCHAR(64) NULL');

    // Expurga os JWTs de recuperação gravados e encerra desafios pendentes.
    await queryInterface.sequelize.query(`
      UPDATE "condominio-bh".tb_recovery_tokens
         SET invite_token = NULL,
             consumed_at = COALESCE(consumed_at, NOW()),
             updated_at = NOW()
       WHERE invite_token IS NOT NULL OR consumed_at IS NULL;
    `);

    await _criarIndiceSeNaoExiste(
      queryInterface,
      'idx_recovery_tokens_reset_hash',
      `CREATE INDEX idx_recovery_tokens_reset_hash ON "condominio-bh".tb_recovery_tokens (reset_token_hash)`
    );
    await _criarIndiceSeNaoExiste(
      queryInterface,
      'idx_recovery_tokens_ip_created',
      `CREATE INDEX idx_recovery_tokens_ip_created ON "condominio-bh".tb_recovery_tokens (request_ip, created_at)`
    );

    // --- 2. token_version -----------------------------------------------------
    await _addColunaSeNaoExiste(queryInterface, 'tb-usuarios', 'token_version', 'INTEGER NOT NULL DEFAULT 0');

    // --- 3. tb_auditoria_seguranca -------------------------------------------
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS "condominio-bh".tb_auditoria_seguranca (
        id               SERIAL PRIMARY KEY,
        id_usuario_ator  INTEGER      NULL,
        id_condominio    INTEGER      NULL,
        acao             VARCHAR(80)  NOT NULL,
        entidade         VARCHAR(80)  NULL,
        entidade_id      VARCHAR(80)  NULL,
        detalhes         TEXT         NULL,
        ip               VARCHAR(64)  NULL,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await _criarIndiceSeNaoExiste(
      queryInterface,
      'idx_auditoria_seguranca_acao_data',
      `CREATE INDEX idx_auditoria_seguranca_acao_data ON "condominio-bh".tb_auditoria_seguranca (acao, created_at)`
    );
    await _criarIndiceSeNaoExiste(
      queryInterface,
      'idx_auditoria_seguranca_entidade',
      `CREATE INDEX idx_auditoria_seguranca_entidade ON "condominio-bh".tb_auditoria_seguranca (entidade, entidade_id)`
    );

    // Índice usado pelo rate limit de login (tb_sgw_log_acesso).
    await _criarIndiceSeNaoExiste(
      queryInterface,
      'idx_sgw_log_acesso_data_evento',
      `CREATE INDEX idx_sgw_log_acesso_data_evento ON "condominio-bh".tb_sgw_log_acesso (data_evento)`
    );
  },

  // Rollback. ATENÇÃO: o código novo depende destas colunas — reverta o
  // deploy ANTES de rodar o down. Os JWTs expurgados não são restaurados (por
  // segurança, não devem ser).
  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "condominio-bh".idx_sgw_log_acesso_data_evento;`);
    await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "condominio-bh".tb_auditoria_seguranca;`);
    await queryInterface.sequelize.query(`ALTER TABLE "condominio-bh"."tb-usuarios" DROP COLUMN IF EXISTS token_version;`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "condominio-bh".idx_recovery_tokens_ip_created;`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "condominio-bh".idx_recovery_tokens_reset_hash;`);
    await queryInterface.sequelize.query(`
      ALTER TABLE "condominio-bh".tb_recovery_tokens
        DROP COLUMN IF EXISTS request_ip,
        DROP COLUMN IF EXISTS reset_used_at,
        DROP COLUMN IF EXISTS reset_expires_at,
        DROP COLUMN IF EXISTS reset_token_hash;
    `);
    // invite_token volta a ser NOT NULL só se não houver linhas nulas.
    await queryInterface.sequelize.query(`
      UPDATE "condominio-bh".tb_recovery_tokens SET invite_token = '' WHERE invite_token IS NULL;
      ALTER TABLE "condominio-bh".tb_recovery_tokens ALTER COLUMN invite_token SET NOT NULL;
    `);
  }
};
