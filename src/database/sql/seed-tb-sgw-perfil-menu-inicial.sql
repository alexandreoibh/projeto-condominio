BEGIN;

-- Carga inicial de permissões na tabela tb_sgw_perfil_menu.
-- Este script considera os perfis padrão:
-- 1 Admin, 2 Morador, 3 Sindico, 4 Sub-Sindico, 5 Portaria.
-- Ajuste as regras abaixo caso sua operação exija outra política.

DELETE FROM "condominio-bh".tb_sgw_perfil_menu
WHERE id_perfil IN (1, 2, 3, 4, 5);

-- Admin: acesso total em todos os menus ativos.
INSERT INTO "condominio-bh".tb_sgw_perfil_menu (
  id_perfil,
  id_menu,
  pode_ver,
  pode_criar,
  pode_editar,
  pode_excluir
)
SELECT
  1 AS id_perfil,
  m.id AS id_menu,
  true AS pode_ver,
  true AS pode_criar,
  true AS pode_editar,
  true AS pode_excluir
FROM "condominio-bh".tb_sgw_menu m
WHERE m.status = true;

-- Sindico: vê todos os menus ativos, cria e edita, mas não exclui.
INSERT INTO "condominio-bh".tb_sgw_perfil_menu (
  id_perfil,
  id_menu,
  pode_ver,
  pode_criar,
  pode_editar,
  pode_excluir
)
SELECT
  3 AS id_perfil,
  m.id AS id_menu,
  true AS pode_ver,
  true AS pode_criar,
  true AS pode_editar,
  false AS pode_excluir
FROM "condominio-bh".tb_sgw_menu m
WHERE m.status = true;

-- Sub-Sindico: vê todos os menus ativos, sem operações destrutivas.
INSERT INTO "condominio-bh".tb_sgw_perfil_menu (
  id_perfil,
  id_menu,
  pode_ver,
  pode_criar,
  pode_editar,
  pode_excluir
)
SELECT
  4 AS id_perfil,
  m.id AS id_menu,
  true AS pode_ver,
  false AS pode_criar,
  true AS pode_editar,
  false AS pode_excluir
FROM "condominio-bh".tb_sgw_menu m
WHERE m.status = true;

-- Morador: visibilidade inicial apenas para menus raiz (nivel 0).
INSERT INTO "condominio-bh".tb_sgw_perfil_menu (
  id_perfil,
  id_menu,
  pode_ver,
  pode_criar,
  pode_editar,
  pode_excluir
)
SELECT
  2 AS id_perfil,
  m.id AS id_menu,
  true AS pode_ver,
  false AS pode_criar,
  false AS pode_editar,
  false AS pode_excluir
FROM "condominio-bh".tb_sgw_menu m
WHERE m.status = true
  AND m.nivel = 0;

-- Portaria: visibilidade inicial apenas para menus raiz (nivel 0).
INSERT INTO "condominio-bh".tb_sgw_perfil_menu (
  id_perfil,
  id_menu,
  pode_ver,
  pode_criar,
  pode_editar,
  pode_excluir
)
SELECT
  5 AS id_perfil,
  m.id AS id_menu,
  true AS pode_ver,
  false AS pode_criar,
  false AS pode_editar,
  false AS pode_excluir
FROM "condominio-bh".tb_sgw_menu m
WHERE m.status = true
  AND m.nivel = 0;

COMMIT;
