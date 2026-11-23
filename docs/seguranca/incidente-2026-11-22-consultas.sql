-- =============================================================================
-- Investigação do incidente de 22/11/2026 — SOMENTE LEITURA (apenas SELECT)
-- IP suspeito: 177.16.189.223
--
-- Como usar:
--   1. Rode em uma réplica/cópia se possível; senão, em produção com um
--      usuário somente leitura. Nenhuma consulta abaixo altera dados.
--   2. Exporte cada resultado (CSV) ANTES de qualquer correção de dados, para
--      preservar evidências. Exporte também os logs da Vercel do período
--      (retenção curta).
--   3. HTTP 200 NÃO prova sucesso: antes desta correção, o lookup de
--      recuperação respondia 200 também quando bloqueava; correlacione com as
--      tabelas de efeito (senha alterada, perfil alterado, receita paga etc.).
--
-- Limitações conhecidas dos registros:
--   - O backend não tinha log de requisições (só tb_sgw_log_acesso para
--     login/logout).
--   - Até esta correção, o IP gravado em tb_sgw_log_acesso podia ser o enviado
--     pelo navegador (body.ip / X-Client-IP) — o atacante podia forjá-lo.
--   - Alterações via PUT/PATCH /usuarios/:id (senha, perfil, e-mail) NÃO eram
--     auditadas; só "updated_at" muda. Não há valor anterior gravado.
--   - O lookup de recuperação (que vazava o token) não gravava IP; deixava
--     apenas uma linha em tb_recovery_tokens.
--   - Ajuste a janela de horário ao fuso do servidor (timestamps podem estar
--     em UTC).
-- =============================================================================

-- Janela de análise (ajuste se necessário)
-- de 2026-11-21 00:00 até 2026-11-24 00:00

-- 1. Acessos (login/logout) do IP suspeito ou na janela -----------------------
SELECT id, data_evento, acao, sucesso, id_usuario, id_condominio, email_informado,
       ip, user_agent, mensagem
  FROM "condominio-bh".tb_sgw_log_acesso
 WHERE (ip = '177.16.189.223' OR mensagem LIKE '%177.16.189.223%' OR user_agent IS NULL)
   AND data_evento >= '2026-11-21' AND data_evento < '2026-11-24'
 ORDER BY data_evento;

-- 1b. Logins bem-sucedidos na janela, agrupados por IP (procure IPs incomuns)
SELECT ip, COUNT(*) AS logins, COUNT(DISTINCT id_usuario) AS usuarios_distintos,
       MIN(data_evento) AS primeiro, MAX(data_evento) AS ultimo
  FROM "condominio-bh".tb_sgw_log_acesso
 WHERE acao = 'LOGIN' AND sucesso = true
   AND data_evento >= '2026-11-21' AND data_evento < '2026-11-24'
 GROUP BY ip
 ORDER BY usuarios_distintos DESC, logins DESC;

-- 2. Recuperação de senha: desafios/tokens gerados na janela ------------------
--    Cada linha = uma chamada ao lookup/request que devolveu (ou gerou) token.
SELECT rt.id, rt.created_at, rt.id_usuario, tu.email, tu.tipo_perfil_id,
       rt.id_condominio, rt.attempts, rt.consumed_at
  FROM "condominio-bh".tb_recovery_tokens rt
  LEFT JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = rt.id_usuario
 WHERE rt.created_at >= '2026-11-21' AND rt.created_at < '2026-11-24'
 ORDER BY rt.created_at;

-- 3. Usuários alterados na janela (senha/perfil/e-mail podem ter mudado) ------
SELECT id, id_condominio, nome, email, tipo_perfil_id, tipo, status,
       created_at, updated_at, last_login_at
  FROM "condominio-bh"."tb-usuarios"
 WHERE updated_at >= '2026-11-21' AND updated_at < '2026-11-24'
 ORDER BY updated_at;

-- 3b. Usuários criados na janela ----------------------------------------------
SELECT id, id_condominio, nome, email, tipo_perfil_id, tipo, status, created_at
  FROM "condominio-bh"."tb-usuarios"
 WHERE created_at >= '2026-11-21' AND created_at < '2026-11-24'
 ORDER BY created_at;

-- 3c. TODOS os usuários com perfil Admin (1) — revisar um a um ----------------
SELECT id, id_condominio, nome, email, tipo, status, created_at, updated_at, last_login_at
  FROM "condominio-bh"."tb-usuarios"
 WHERE tipo_perfil_id = 1 OR lower(tipo) = 'admin'
 ORDER BY updated_at DESC;

-- 3d. Correlação: recuperação gerada para um usuário seguida de alteração dele
SELECT rt.id_usuario, tu.email, rt.created_at AS recuperacao_em, tu.updated_at AS alterado_em,
       tu.tipo_perfil_id, tu.status
  FROM "condominio-bh".tb_recovery_tokens rt
  JOIN "condominio-bh"."tb-usuarios" tu ON tu.id = rt.id_usuario
 WHERE rt.created_at >= '2026-11-21' AND rt.created_at < '2026-11-24'
   AND tu.updated_at BETWEEN rt.created_at AND rt.created_at + INTERVAL '24 hours'
 ORDER BY rt.created_at;

-- 3e. Login logo após recuperação (possível tomada de conta)
SELECT rt.id_usuario, rt.created_at AS recuperacao_em, la.data_evento AS login_em, la.ip, la.user_agent
  FROM "condominio-bh".tb_recovery_tokens rt
  JOIN "condominio-bh".tb_sgw_log_acesso la
    ON la.id_usuario = rt.id_usuario AND la.acao = 'LOGIN' AND la.sucesso = true
   AND la.data_evento BETWEEN rt.created_at AND rt.created_at + INTERVAL '24 hours'
 WHERE rt.created_at >= '2026-11-21' AND rt.created_at < '2026-11-24'
 ORDER BY rt.created_at;

-- 4. Webhook bancário: chamadas na janela (o endpoint não tinha autenticação)
SELECT id, recebido_em, provider, ip_origem, status_processamento, evento_tipo,
       id_externo, id_condominio, erro_detalhe, payload_bruto
  FROM "condominio-bh".tb_webhook_bancario_log
 WHERE recebido_em >= '2026-11-21' AND recebido_em < '2026-11-24'
 ORDER BY recebido_em;

-- 4b. IPs de origem do webhook em todo o histórico (o Inter usa poucos IPs;
--     qualquer IP fora do padrão é suspeito)
SELECT ip_origem, COUNT(*) AS chamadas, MIN(recebido_em) AS primeira, MAX(recebido_em) AS ultima
  FROM "condominio-bh".tb_webhook_bancario_log
 GROUP BY ip_origem
 ORDER BY chamadas DESC;

-- 4c. Cobranças que ficaram "paga" ou "cancelada" desde 21/11 — CONFERIR UMA A
--     UMA NO INTERNET BANKING DO INTER (o webhook aplicava o status do payload
--     sem reconsultar o banco).
SELECT cb.id, cb.id_condominio, cb.id_receita, cb.situacao, cb.id_externo, cb.valor,
       cb.data_pagamento, cb.updated_at, r.situacao AS situacao_receita
  FROM "condominio-bh".tb_fin_cobranca_bancaria cb
  LEFT JOIN "condominio-bh".tb_fin_receitas r ON r.id = cb.id_receita
 WHERE cb.situacao IN ('paga', 'cancelada')
   AND cb.updated_at >= '2026-11-21'
 ORDER BY cb.updated_at;

-- 5. Integrações bancárias alteradas/criadas na janela -------------------------
SELECT id, id_condominio, provider, ativo, created_at, updated_at
  FROM "condominio-bh".tb_fin_integracao_bancaria
 WHERE created_at >= '2026-11-21' OR updated_at >= '2026-11-21'
 ORDER BY updated_at DESC;

-- 6. Relatórios automáticos: configurações recentes (procure e-mails externos)
SELECT *
  FROM "condominio-bh".tb_sgw_rel_envio_config
 ORDER BY id DESC
 LIMIT 200;

SELECT *
  FROM "condominio-bh".tb_sgw_rel_envio_log
 ORDER BY id DESC
 LIMIT 200;

-- 7. Condomínios criados/alterados na janela ----------------------------------
SELECT id, nome, email, ativo, created_at, updated_at
  FROM "condominio-bh"."tb-condominios"
 WHERE created_at >= '2026-11-21' OR updated_at >= '2026-11-21'
 ORDER BY updated_at DESC;

-- 8. Depois do deploy desta correção: trilha de auditoria nova -----------------
-- SELECT * FROM "condominio-bh".tb_auditoria_seguranca ORDER BY created_at DESC LIMIT 500;
