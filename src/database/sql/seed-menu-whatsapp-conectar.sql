BEGIN;

-- Seed idempotente: item de menu "WhatsApp" (tela /whatsapp-conectar no front PHP)
-- e permissões de visualização para os perfis 1 (Admin), 3 (Sindico), 4 (Sub-Sindico).
-- Não editar seed-tb-sgw-perfil-menu-inicial.sql — este é um script complementar.

-- 1) Item de menu (só insere se ainda não existir um com a mesma rota).
INSERT INTO "condominio-bh".tb_sgw_menu (nome, rota, icone, nivel, id_menu_pai, ordem, status)
SELECT 'WhatsApp', '/whatsapp-conectar', 'whatsapp', 1, NULL, 999, true
WHERE NOT EXISTS (
  SELECT 1 FROM "condominio-bh".tb_sgw_menu WHERE rota = '/whatsapp-conectar'
);

-- 2) Permissões de visualização (pode_ver = true) para Admin (1), Sindico (3), Sub-Sindico (4).
INSERT INTO "condominio-bh".tb_sgw_perfil_menu (id_perfil, id_menu, pode_ver, pode_criar, pode_editar, pode_excluir)
SELECT p.id_perfil, m.id, true, false, false, false
FROM (VALUES (1), (3), (4)) AS p(id_perfil)
CROSS JOIN "condominio-bh".tb_sgw_menu m
WHERE m.rota = '/whatsapp-conectar'
  AND NOT EXISTS (
    SELECT 1
      FROM "condominio-bh".tb_sgw_perfil_menu pm
     WHERE pm.id_perfil = p.id_perfil
       AND pm.id_menu = m.id
  );

COMMIT;
