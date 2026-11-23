-- =============================================================================
-- Hardening pós-incidente de 22/11/2026
-- Equivalente SQL da migration
--   src/database/migrations/20261123000001-hardening-recovery-sessoes-auditoria.js
--
-- Idempotente (pode rodar mais de uma vez). Feito para PostgreSQL 18
-- (produção); a sintaxe também funciona no 9.2.
--
-- ANTES DE RODAR: backup das tabelas afetadas, por exemplo:
--   pg_dump -h <host> -U <usuario> -d <banco> \
--     -t '"condominio-bh".tb_recovery_tokens' \
--     -t '"condominio-bh"."tb-usuarios"' > backup-hardening-2026-11-23.sql
-- (No PG 11+, adicionar token_version NOT NULL DEFAULT 0 é instantâneo e não
-- reescreve "tb-usuarios".)
--
-- Rollback: hardening-recovery-sessoes-auditoria-2026-11-23-rollback.sql
-- =============================================================================

BEGIN;

-- --- 1. tb_recovery_tokens ---------------------------------------------------
-- O JWT de recuperação deixa de ser gravado; passa a existir um reset token
-- opaco de uso único, do qual só o sha256 é gravado.
ALTER TABLE "condominio-bh".tb_recovery_tokens ALTER COLUMN invite_token DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'condominio-bh' AND table_name = 'tb_recovery_tokens' AND column_name = 'reset_token_hash') THEN
    ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN reset_token_hash VARCHAR(64) NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'condominio-bh' AND table_name = 'tb_recovery_tokens' AND column_name = 'reset_expires_at') THEN
    ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN reset_expires_at TIMESTAMPTZ NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'condominio-bh' AND table_name = 'tb_recovery_tokens' AND column_name = 'reset_used_at') THEN
    ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN reset_used_at TIMESTAMPTZ NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'condominio-bh' AND table_name = 'tb_recovery_tokens' AND column_name = 'request_ip') THEN
    ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN request_ip VARCHAR(64) NULL;
  END IF;
END $$;

-- Expurga os JWTs de recuperação gravados e encerra os desafios pendentes.
UPDATE "condominio-bh".tb_recovery_tokens
   SET invite_token = NULL,
       consumed_at  = COALESCE(consumed_at, NOW()),
       updated_at   = NOW()
 WHERE invite_token IS NOT NULL OR consumed_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname = 'idx_recovery_tokens_reset_hash') THEN
    CREATE INDEX idx_recovery_tokens_reset_hash ON "condominio-bh".tb_recovery_tokens (reset_token_hash);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname = 'idx_recovery_tokens_ip_created') THEN
    CREATE INDEX idx_recovery_tokens_ip_created ON "condominio-bh".tb_recovery_tokens (request_ip, created_at);
  END IF;
END $$;

-- --- 2. token_version (revogação de sessões, claim `tv` do JWT) --------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'condominio-bh' AND table_name = 'tb-usuarios' AND column_name = 'token_version') THEN
    ALTER TABLE "condominio-bh"."tb-usuarios" ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- --- 3. tb_auditoria_seguranca -----------------------------------------------
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname = 'idx_auditoria_seguranca_acao_data') THEN
    CREATE INDEX idx_auditoria_seguranca_acao_data ON "condominio-bh".tb_auditoria_seguranca (acao, created_at);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname = 'idx_auditoria_seguranca_entidade') THEN
    CREATE INDEX idx_auditoria_seguranca_entidade ON "condominio-bh".tb_auditoria_seguranca (entidade, entidade_id);
  END IF;

  -- Índice usado pelo rate limit de login.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname = 'idx_sgw_log_acesso_data_evento') THEN
    CREATE INDEX idx_sgw_log_acesso_data_evento ON "condominio-bh".tb_sgw_log_acesso (data_evento);
  END IF;
END $$;

COMMIT;

-- --- Verificação: a 1ª consulta deve retornar 5 linhas e a 2ª, não nula -----
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE table_schema = 'condominio-bh'
   AND ((table_name = 'tb_recovery_tokens' AND column_name IN ('reset_token_hash', 'reset_expires_at', 'reset_used_at', 'request_ip'))
     OR (table_name = 'tb-usuarios' AND column_name = 'token_version'))
 ORDER BY table_name, column_name;

SELECT to_regclass('"condominio-bh".tb_auditoria_seguranca') AS tabela_auditoria;
