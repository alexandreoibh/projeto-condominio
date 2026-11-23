-- =============================================================================
-- ROLLBACK de hardening-recovery-sessoes-auditoria-2026-11-23.sql
--
-- ATENÇÃO: o código da v2.58+ depende destas colunas e tabelas. Reverta o
-- deploy na Vercel ANTES de rodar este script, senão recuperação de senha,
-- login (rate limit) e sessões passam a falhar.
-- Os JWTs de recuperação expurgados NÃO são restaurados (por segurança, não
-- devem ser).
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS "condominio-bh".idx_sgw_log_acesso_data_evento;
DROP TABLE IF EXISTS "condominio-bh".tb_auditoria_seguranca;

ALTER TABLE "condominio-bh"."tb-usuarios" DROP COLUMN IF EXISTS token_version;

DROP INDEX IF EXISTS "condominio-bh".idx_recovery_tokens_ip_created;
DROP INDEX IF EXISTS "condominio-bh".idx_recovery_tokens_reset_hash;

ALTER TABLE "condominio-bh".tb_recovery_tokens
  DROP COLUMN IF EXISTS request_ip,
  DROP COLUMN IF EXISTS reset_used_at,
  DROP COLUMN IF EXISTS reset_expires_at,
  DROP COLUMN IF EXISTS reset_token_hash;

-- invite_token volta a ser NOT NULL (linhas nulas recebem '').
UPDATE "condominio-bh".tb_recovery_tokens SET invite_token = '' WHERE invite_token IS NULL;
ALTER TABLE "condominio-bh".tb_recovery_tokens ALTER COLUMN invite_token SET NOT NULL;

COMMIT;
