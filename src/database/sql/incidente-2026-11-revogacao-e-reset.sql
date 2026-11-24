-- =============================================================================
-- Incidente 22–23/11/2026 — revogação global de sessões e redefinição segura
-- das senhas dos usuários 10, 12, 56 e 95.
--
-- NÃO EXECUTADO. Rodar só com autorização, DEPOIS de:
--   1. publicar o backend corrigido (rejeita JWT sem `tv`, só bcrypt);
--   2. rotacionar JWT_SECRET, SERVICE_INVITE_TOKEN_SECRET e os tokens do Blob;
--   3. remover/proteger os deployments antigos da Vercel.
-- Fazer backup antes (pg_dump de "condominio-bh"."tb-usuarios" e
-- "condominio-bh".tb_recovery_tokens).
-- Nenhuma consulta abaixo exibe senha, hash completo ou token.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. PRÉ-CONFERÊNCIA (somente leitura) — rode e confira manualmente.
-- -----------------------------------------------------------------------------

-- 0a. Contatos dos alvos: compare e-mail/CPF/telefone com o backup ANTERIOR a
--     22/11. O código de recuperação vai para o e-mail gravado aqui: se algum
--     foi trocado pelo atacante, restaure o legítimo ANTES do passo 2.
SELECT id, id_condominio, tipo_perfil_id, status, email, cpf, telefone,
       token_version, updated_at, last_login_at,
       (senha_hash IS NULL)                AS sem_hash,
       left(coalesce(senha_hash, ''), 4)   AS prefixo_hash
  FROM "condominio-bh"."tb-usuarios"
 WHERE id IN (10, 12, 56, 95)
 ORDER BY id;

-- 0b. Pré-requisitos: coluna token_version e extensão pgcrypto.
SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'condominio-bh' AND table_name = 'tb-usuarios'
   AND column_name IN ('token_version', 'senha_hash');
SELECT extname FROM pg_extension WHERE extname = 'pgcrypto';
-- Se vier vazio:  CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 0c. Impacto da desativação da senha legada em texto puro: quantos usuários
--     ativos ainda NÃO têm hash bcrypt (precisarão usar "Esqueci minha senha").
SELECT count(*) AS usuarios_sem_bcrypt
  FROM "condominio-bh"."tb-usuarios"
 WHERE status IN ('ativo', 'Ativo')
   AND (senha_hash IS NULL OR senha_hash !~ '^\$2[aby]\$[0-9]{2}\$');

-- 0d. Admins (perfil 1): confira a lista e defina SUPERADMIN_USER_IDS na Vercel.
SELECT id, id_condominio, email, status, created_at, updated_at
  FROM "condominio-bh"."tb-usuarios"
 WHERE tipo_perfil_id = 1
 ORDER BY id;

-- -----------------------------------------------------------------------------
-- 1. REVOGAÇÃO GLOBAL + REDEFINIÇÃO (transação única)
-- -----------------------------------------------------------------------------
BEGIN;

-- Não espera indefinidamente por locks (ex.: transação presa em tb-usuarios).
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- 1a. Senha dos alvos substituída por bcrypt de um segredo aleatório que
--     ninguém conhece (não usar NULL/marcador: o formato bcrypt funciona com
--     qualquer versão do código e respeita NOT NULL). Também revoga sessões.
--     Trava: se não forem exatamente 4 usuários, a transação inteira aborta.
DO $$
DECLARE
  afetados integer;
BEGIN
  UPDATE "condominio-bh"."tb-usuarios"
     SET senha_hash    = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 10)),
         token_version = COALESCE(token_version, 0) + 1,
         updated_at    = NOW()
   WHERE id IN (10, 12, 56, 95);
  GET DIAGNOSTICS afetados = ROW_COUNT;
  IF afetados <> 4 THEN
    RAISE EXCEPTION 'Reset afetou % usuário(s), esperado 4. Nada foi alterado.', afetados;
  END IF;
END $$;

SELECT id, token_version, left(senha_hash, 4) AS prefixo
  FROM "condominio-bh"."tb-usuarios"
 WHERE id IN (10, 12, 56, 95);
-- Esperado: 4 linhas, prefixo '$2a$'.

-- 1b. Revogação global: todo JWT emitido até agora deixa de valer (o usuário
--     faz login de novo). Exclui os alvos, já incrementados em 1a.
UPDATE "condominio-bh"."tb-usuarios"
   SET token_version = COALESCE(token_version, 0) + 1
 WHERE id NOT IN (10, 12, 56, 95);

-- 1c. Encerra TODOS os desafios e reset tokens de recuperação pendentes e
--     apaga qualquer JWT de recuperação legado ainda gravado.
UPDATE "condominio-bh".tb_recovery_tokens
   SET consumed_at   = COALESCE(consumed_at, NOW()),
       reset_used_at = COALESCE(reset_used_at, NOW()),
       invite_token  = NULL,
       updated_at    = NOW()
 WHERE consumed_at IS NULL OR reset_used_at IS NULL OR invite_token IS NOT NULL;

-- 1d. Registro na trilha de auditoria (sem dados sensíveis).
INSERT INTO "condominio-bh".tb_auditoria_seguranca
       (id_usuario_ator, id_condominio, acao, entidade, entidade_id, detalhes, ip, created_at)
VALUES (NULL, NULL, 'incidente_revogacao_global', 'usuario', '10,12,56,95',
        '{"motivo":"incidente 22-23/11/2026","script":"incidente-2026-11-revogacao-e-reset.sql"}', NULL, NOW());

-- Confira os RETURNING/contagens acima. Se algo estiver errado: ROLLBACK;
COMMIT;

-- -----------------------------------------------------------------------------
-- 2. CONFERÊNCIA (aguarde 60 s após o COMMIT: cache de sessão por instância)
-- -----------------------------------------------------------------------------
SELECT id, token_version, left(senha_hash, 4) AS prefixo
  FROM "condominio-bh"."tb-usuarios"
 WHERE id IN (10, 12, 56, 95);                       -- prefixo '$2a$', tv >= 1

SELECT count(*) AS usuarios_com_tv_zero
  FROM "condominio-bh"."tb-usuarios"
 WHERE COALESCE(token_version, 0) = 0;               -- esperado 0

SELECT count(*) AS recuperacoes_pendentes
  FROM "condominio-bh".tb_recovery_tokens
 WHERE consumed_at IS NULL OR reset_used_at IS NULL; -- esperado 0

-- Depois: cada um dos 4 usuários usa "Esqueci minha senha" e recebe o código
-- no e-mail conferido em 0a. Para o 56 (Admin), confirme por canal externo
-- (telefone) que o titular controla essa caixa de e-mail.
