-- Hardening pós-incidente 22/11/2026: equivalente SQL da migration
-- src/database/migrations/20261123000001-hardening-recovery-sessoes-auditoria.js
-- PostgreSQL 18. Idempotente: pode rodar mais de uma vez sem dano.
--
-- ANTES DE RODAR: faça backup de tb_recovery_tokens e "tb-usuarios".
-- ATENÇÃO: o UPDATE abaixo encerra todas as recuperações de senha em andamento.

BEGIN;

-- 1. tb_recovery_tokens ------------------------------------------------------
ALTER TABLE "condominio-bh".tb_recovery_tokens ALTER COLUMN invite_token DROP NOT NULL;
ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(64) NULL;
ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ NULL;
ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN IF NOT EXISTS reset_used_at    TIMESTAMPTZ NULL;
ALTER TABLE "condominio-bh".tb_recovery_tokens ADD COLUMN IF NOT EXISTS request_ip       VARCHAR(64) NULL;

-- Expurga os JWTs de recuperação gravados e encerra os desafios pendentes.
UPDATE "condominio-bh".tb_recovery_tokens
   SET invite_token = NULL,
       consumed_at  = COALESCE(consumed_at, NOW()),
       updated_at   = NOW()
 WHERE invite_token IS NOT NULL OR consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_reset_hash
    ON "condominio-bh".tb_recovery_tokens (reset_token_hash);
CREATE INDEX IF NOT EXISTS idx_recovery_tokens_ip_created
    ON "condominio-bh".tb_recovery_tokens (request_ip, created_at);

-- 2. Revogação de sessões (claim `tv` do JWT) --------------------------------
ALTER TABLE "condominio-bh"."tb-usuarios" ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- 3. Trilha de auditoria ------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_auditoria_seguranca_acao_data
    ON "condominio-bh".tb_auditoria_seguranca (acao, created_at);
CREATE INDEX IF NOT EXISTS idx_auditoria_seguranca_entidade
    ON "condominio-bh".tb_auditoria_seguranca (entidade, entidade_id);

-- Índice usado pelo rate limit de login.
CREATE INDEX IF NOT EXISTS idx_sgw_log_acesso_data_evento
    ON "condominio-bh".tb_sgw_log_acesso (data_evento);

COMMIT;

-- Conferência (rode depois do COMMIT) -----------------------------------------
-- Esperado: 5 linhas
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema = 'condominio-bh'
--    AND ((table_name = 'tb_recovery_tokens' AND column_name IN ('reset_token_hash','reset_expires_at','reset_used_at','request_ip'))
--      OR (table_name = 'tb-usuarios' AND column_name = 'token_version'));
-- Esperado: 5 linhas
-- SELECT indexname FROM pg_indexes WHERE schemaname = 'condominio-bh' AND indexname IN
--  ('idx_recovery_tokens_reset_hash','idx_recovery_tokens_ip_created','idx_auditoria_seguranca_acao_data',
--   'idx_auditoria_seguranca_entidade','idx_sgw_log_acesso_data_evento');
-- Esperado: não nulo
-- SELECT to_regclass('"condominio-bh".tb_auditoria_seguranca');
-- Esperado: 0
-- SELECT count(*) FROM "condominio-bh".tb_recovery_tokens WHERE invite_token IS NOT NULL;
