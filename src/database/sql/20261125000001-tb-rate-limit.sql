-- =============================================================================
-- Rate limit persistente da recuperação de senha (hardening 25/11/2026)
-- Equivalente à migration 20261125000001-tb-rate-limit.js. Idempotente.
--
-- NÃO EXECUTADO. Rodar no Neon ANTES do deploy do backend: sem a tabela, a
-- recuperação de senha responde 503 (fail closed). O resto do sistema não é
-- afetado.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "condominio-bh".tb_rate_limit (
  chave          VARCHAR(200) NOT NULL,          -- ex.: rec:req:ip:<ip>, rec:req:login:<hmac>
  janela         TIMESTAMPTZ  NOT NULL,          -- início da janela fixa (cooldown usa epoch 0)
  contador       INTEGER      NOT NULL DEFAULT 0 CHECK (contador >= 0),
  atualizado_em  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chave, janela)
);

-- Retenção (48 h) é feita por atualizado_em.
CREATE INDEX IF NOT EXISTS idx_rate_limit_atualizado_em
    ON "condominio-bh".tb_rate_limit (atualizado_em);

-- Permissões mínimas do usuário da aplicação (app_emorador). Sem sequence:
-- a tabela não tem coluna serial. O dono continua sendo o usuário de
-- migration. Ajuste o nome do role se for diferente.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_emorador') THEN
    GRANT USAGE ON SCHEMA "condominio-bh" TO app_emorador;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "condominio-bh".tb_rate_limit TO app_emorador;
  ELSE
    RAISE NOTICE 'Role app_emorador não existe: conceda SELECT, INSERT, UPDATE, DELETE em tb_rate_limit ao usuário da aplicação.';
  END IF;
END $$;

COMMIT;

-- Conferência
SELECT to_regclass('"condominio-bh".tb_rate_limit') AS tabela;      -- não nulo
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privilegios
  FROM information_schema.role_table_grants
 WHERE table_schema = 'condominio-bh' AND table_name = 'tb_rate_limit'
 GROUP BY grantee;

-- Limpeza manual (o backend já limpa sozinho, em lotes). Repita até "apagadas" = 0.
-- WITH apagadas AS (
--   DELETE FROM "condominio-bh".tb_rate_limit
--    WHERE ctid IN (SELECT ctid FROM "condominio-bh".tb_rate_limit
--                    WHERE atualizado_em < now() - interval '48 hours' LIMIT 1000)
--   RETURNING 1)
-- SELECT count(*) AS apagadas FROM apagadas;

-- Rollback (só se necessário; o backend volta a responder 503 na recuperação):
-- DROP TABLE IF EXISTS "condominio-bh".tb_rate_limit;
