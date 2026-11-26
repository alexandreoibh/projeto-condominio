-- =============================================================================
-- Fila de mensagens (tb_mensagens_fila) — consultas de revisão (26/11/2026)
--
-- NÃO é migration: nenhuma DDL é necessária. `status` é INTEGER sem CHECK,
-- então os novos valores 4 e 5 já são aceitos. Os registros existentes
-- (inclusive os 22 em status 2) NÃO são alterados por este deploy.
--
-- Status:
--   1 pendente
--   2 aceito pelo fornecedor (NÃO é entrega confirmada ao destinatário)
--   3 falha confirmada: nada foi enviado (rejeição, canal desativado/sem
--     configuração, destinatário sem contato ou fora do condomínio)
--   4 em processamento (reservado por uma execução). Nunca volta a 1 sozinho.
--   5 resultado indeterminado (timeout, erro de rede, HTTP 502/504, ou aceito
--     sem conseguir gravar o status 2). Pode ter sido enviado: revisão manual.
--
-- Atenção: o histórico em status 2 anterior a este deploy, de tipo whatsapp ou
-- telegram, pode ter sido marcado sem envio real (bug corrigido: serviço sem
-- configuração retornava sem erro). Não há como distinguir pelo banco.
-- =============================================================================

-- 1) Panorama por canal e status
SELECT tipo, status, count(*) AS total, min(created_at) AS mais_antiga, max(updated_at) AS ultima_atualizacao
  FROM "condominio-bh".tb_mensagens_fila
 GROUP BY tipo, status
 ORDER BY tipo, status;

-- 2) Presas em processamento (status 4 há mais de 15 min): execução
--    interrompida no meio do envio. Conferir no fornecedor antes de decidir.
SELECT id, id_condominio, tipo, modulo, created_at, updated_at
  FROM "condominio-bh".tb_mensagens_fila
 WHERE status = 4
   AND updated_at < now() - interval '15 minutes'
 ORDER BY updated_at;

-- 3) Indeterminadas (status 5)
SELECT id, id_condominio, tipo, modulo, falha, data_cron_execucao
  FROM "condominio-bh".tb_mensagens_fila
 WHERE status = 5
 ORDER BY data_cron_execucao;

-- 4) Falhas recentes por código
SELECT split_part(falha, ' ', 1) AS codigo, tipo, count(*) AS total
  FROM "condominio-bh".tb_mensagens_fila
 WHERE status = 3
   AND data_cron_execucao > now() - interval '7 days'
 GROUP BY 1, 2
 ORDER BY total DESC;

-- 5) Resolução MANUAL, por id, depois de conferir no fornecedor. Sem efeito
--    em lote. Descomente e ajuste o id e o desfecho.
--
-- Confirmado que foi enviado:
-- UPDATE "condominio-bh".tb_mensagens_fila
--    SET status = 2, falha = 'REVISADO_MANUAL: enviado', updated_at = now()
--  WHERE id = :id AND status IN (4, 5);
--
-- Confirmado que NÃO foi enviado e deve ser reenviado pelo cron:
-- UPDATE "condominio-bh".tb_mensagens_fila
--    SET status = 1, falha = 'REVISADO_MANUAL: reenviar', updated_at = now()
--  WHERE id = :id AND status IN (4, 5);
--
-- Confirmado que NÃO foi enviado e não deve ser reenviado:
-- UPDATE "condominio-bh".tb_mensagens_fila
--    SET status = 3, falha = 'REVISADO_MANUAL: descartado', updated_at = now()
--  WHERE id = :id AND status IN (4, 5);

-- Rollback do deploy: não há DDL a desfazer. Ao voltar para a versão
-- anterior, itens em 4 ou 5 ficam parados (a versão antiga só lê status 1) —
-- resolva-os com o item 5 acima antes ou depois do rollback.
