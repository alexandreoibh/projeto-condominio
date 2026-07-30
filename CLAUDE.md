# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

API REST em **Node.js + Express + PostgreSQL (Sequelize)** para gestão de condomínios (app e-Morador).
Porta padrão: `3001`. Prefixo de todas as rotas: `/api`. Deploy via **Vercel** (`vercel.json` aponta `server.js`).

## Comandos

```bash
npm install
npm start              # nodemon server.js — reinicia automaticamente
npx sequelize-cli migrate:latest   # rodar migrations pendentes
```

`server.js` autentica a conexão PostgreSQL antes de `app.listen`; se falhar, processo encerra com `process.exit(1)`.

Healthcheck: `GET /api/health` → `{ status: "ok", service: "backend-condominio" }`

## Estrutura de pastas

```
src/
├── app.js                      # Bootstrap Express — registra rotas e middlewares globais
├── server.js  (raiz)           # Entry point — conecta PostgreSQL, inicia servidor, carrega cron tasks
├── controllers/
│   ├── condominioController.js # Controlador principal (>11k linhas) — espaços, moradores, menu, push, fatura, consumo, dashboards, relatórios, regulamentos, recovery
│   ├── reuniaoController.js    # Controlador isolado para o domínio de reuniões
│   ├── usuarioController.js    # Push tokens, perfil de usuário
│   ├── loginController.js      # Login / autenticação
│   └── pdfController.js        # Geração de PDFs
├── routes/
│   ├── condominio.js           # /api/condominio/*
│   ├── login.js                # /api/login
│   ├── usuario.js              # /api/usuario/*
│   ├── recovery.js             # /api/auth/recovery/*
│   └── reuniao.js              # /api/reuniao/*
├── database/
│   ├── postgres.js             # Instância Sequelize (singleton)
│   ├── config_postgres.js      # Config de conexão lida do .env
│   └── migrations/             # Sequelize migrations (sequelizerc aponta para cá)
├── helpers/
│   ├── auth.js                 # Middleware JWT — popula campos no req
│   ├── validate.js             # Middleware express-validator — retorna 422 se houver erros
│   └── avatarProxy.js          # Helpers para URLs de avatar/imagem (Vercel Blob)
├── service/
│   ├── pushNotificationService.js   # Expo push notifications
│   └── emailDispatchService.js      # Envio de e-mails via serviço externo (com retry 3×, sem retry em 4xx)
└── task/
    ├── lembreteReserva.js      # Cron diário — envia e-mail de lembrete para reservas do dia seguinte
    └── acoes_tela.js           # Tarefas/ações de tela
```

## Autenticação e JWT

- Todas as rotas protegidas usam o middleware `src/helpers/auth.js`.
- O token é aceito em: `Authorization: Bearer <token>`, header `x-access-token`, query `?token=` ou body `token`.
- Após verificação, o middleware injeta no `req`:

| Campo | Origem no token | Descrição |
|---|---|---|
| `req.idcliente` | `id` | ID do usuário |
| `req.id_condominio` | `id_condominio` | ID do condomínio — usado em todas as queries |
| `req.IdPerfil` | `IdPerfil` | ID do perfil de acesso |
| `req.nomePerfil` | `nome_perfil` / `role` | Nome do perfil |
| `req.emailUsuario` | `email` | E-mail do usuário |
| `req.cpf` | `cpf` | CPF do usuário |
| `req.empresa` | `empresa` | Sempre `"condominio"` neste projeto |

> **Importante:** `id_condominio` nunca deve ser enviado no body/query pelos clientes — é sempre extraído do token.

## Perfis de acesso

| `tipo_perfil_id` | Perfil | Descrição |
|---|---|---|
| 1 | Admin | Acesso total, gerencia permissões de menu |
| 2 | Morador | Residente — acesso restrito |
| 3 | Sindico | Gestor do condomínio |
| 4 | Sub-Sindico | Gestor auxiliar |
| 5 | Portaria | Controle de acesso/visitantes |
| 54 | Colaborador | Equipe de apoio do condomínio (limpeza, manutenção etc.) |

- Tabela de perfis: `"condominio-bh".tb_sgw_perfil` (id, nome, status) — apesar do nome "sgw", vive no schema `condominio-bh`.
- `"condominio-bh"."tb-usuarios".tipo_perfil_id` referencia esse id. A coluna `tipo` (varchar) da mesma tabela guarda o nome do perfil normalizado (lowercase, sem acento — ex.: `'sindico'`, `'portaria'`) e **precisa ser mantida em sincronia manualmente**: `criarUsuario`/`editarUsuario` resolvem `tipo` a partir de `tipo_perfil_id` via SELECT em `tb_sgw_perfil` sempre que o front não envia `tipo` explicitamente.
- Portaria e Colaborador têm acesso de leitura a dados de morador (nome/email/apartamento/bloco) nas listagens de agenda de espaços — ver `_podeVisualizarDadosMorador()` em `condominioController.js`.
- Permissões de menu ficam na tabela `tb_sgw_perfil_menu`. O seed inicial está em `src/database/sql/seed-tb-sgw-perfil-menu-inicial.sql` (cobre só os perfis 1-5; Colaborador/54 foi adicionado depois, fora do seed).

## Padrão de rotas

```
routes/condominio.js  →  router.get('/rota', auth, [validações], validate, controller.metodo)
```

- `auth` — middleware de autenticação JWT
- Validações — array de regras `express-validator` (`body()`, `query()`, `param()`)
- `validate` — middleware que rejeita com 422 se houver erros de validação
- `controller.metodo.bind(controller)` — método do controller correspondente

Rotas especiais em `condominio.js`:
- `publicRegistrationKeyGuard` — guarda por header `X-Public-Registration-Key` (timing-safe compare), sem JWT
- `authOrInviteToken` — aceita invite_token no lugar de JWT (fluxo de convite de morador)

## Banco de dados

- ORM: **Sequelize** com driver `pg`
- Conexão: instância única em `src/database/postgres.js`
- Queries complexas usam `postgres.query(sql, { replacements, type: QueryTypes.SELECT })`
- Schema das tabelas SGW (perfis/menu): `sgw` — ex: `sgw.tb_sgw_perfil_menu`
- Schema das tabelas de condomínio (moradores, espaços, agenda): `"condominio-bh"` — ex: `"condominio-bh"."tb-usuarios"`, `"condominio-bh".tb_espaco`
- O schema `"condominio-bh"` tem nomes de tabelas mistos (com e sem hifens), sempre usar aspas duplas quando necessário no SQL raw

## Unidades por bloco (`tb_condominios_unidades`)

Quando o síndico/admin cadastra ou edita um condomínio (`POST`/`PUT /api/condominio/condominios[/:id]`, `criarCondominio`/`editarCondominio` em `condominioController.js`), o backend gera automaticamente uma unidade (apartamento) para **cada bloco/torre** do condomínio, a partir de dois campos do body:

- `qtde_blocos` (ou alias legado `qtde_bloco`): quantidade de blocos/torres.
- `unidades_bloco`: array plano de strings — a lista-modelo de unidades a replicar em cada bloco (ex.: `["101", "102", "201"]`).

O total de registros gerados é `qtde_blocos × unidades_bloco.length` em `"condominio-bh".tb_condominios_unidades` (colunas: `id`, `id_condominio`, `unidades_bloco` — o texto da unidade —, `bloco` int inteiro sequencial `1..qtde_blocos`, `created_at`). Cada combinação bloco×unidade tem seu próprio `id`, mesmo quando o texto se repete entre blocos (ex.: bloco 1 "101" e bloco 2 "101" são registros distintos) — esse `id` é a referência estável usada para vincular o morador à unidade (`tb_fin_receitas.id_unidade`, `loginController.js` resolvendo `id_unidade` no login).

**Regra crítica: nunca recriar/apagar unidades já existentes.** `_sincronizarUnidadesCondominio()` faz upsert real — busca o que já existe por `(bloco, unidades_bloco)` e só insere as combinações que ainda faltam (ex.: síndico aumenta de 2 para 3 blocos → só o bloco 3 ganha registros novos; blocos 1 e 2 mantêm os mesmos IDs). Isso é essencial porque apagar e recriar quebraria vínculos já feitos (moradores, receitas financeiras). As unidades são ordenadas por texto (`localeCompare` com `numeric: true`, ex. "2" antes de "10") antes de distribuir por bloco.

`_buscarCondominioComUnidades()`, `listarCondominios()` e `buscarCondominioPorId()` retornam `unidades_bloco` como array de objetos `{ id, bloco, unidade }` (não mais array de strings), ordenado por bloco e depois por texto — os três pontos de leitura de condomínio precisam ficar consistentes entre si sempre que esse formato mudar.

**Cuidado com JSON agregado no Postgres via Sequelize:** `json_build_object` é variádico e, chamado como *prepared statement* (padrão do Sequelize), falha ao inferir tipo se os argumentos não tiverem cast explícito (erro real já visto em produção: `function json_build_object(unknown, integer, unknown, integer, unknown, character varying) does not exist`). Sempre castar explicitamente cada valor (`cu.id::int`, `cu.bloco::int`, `cu.unidades_bloco::text`) ao montar JSON agregado em SQL raw.

**JOINs que casam morador por unidade precisam considerar `bloco`, não só o texto.** Como o mesmo texto de unidade agora pode existir em vários blocos, qualquer JOIN que resolve "o morador daquela unidade" comparando só `tb-usuarios.apartamento = tb_condominios_unidades.unidades_bloco` fica ambíguo — precisa também comparar bloco (`NULLIF(tu.bloco, '')::int = cu.bloco`, já que `tb-usuarios.bloco` é sempre texto e `tb_condominios_unidades.bloco` é `int4`). Esse padrão está em `financeiroController.js` (relatórios de receita/inadimplência) e `loginController.js` (resolução de `id_unidade` no login).

Sem migration formal — `tb_condominios_unidades` (como `tb-condominios` e `tb-usuarios`) é gerenciada fora do fluxo de migrations do Sequelize.

## Estado em memória (não persistido)

Três Maps no `CondominioController` sobrevivem apenas enquanto o processo estiver vivo:

| Map | Propósito | TTL |
|---|---|---|
| `publicRegistrationAttempts` | Rate limiting de registro público — 5 tentativas / 15 min por IP | 15 min |
| `usedInviteTokens` | Rastreia uso de invite tokens — máx 100 usos | 24h |
| `recoveryOtpStore` | OTP de recuperação de senha por e-mail | 10 min |

## Integrações externas

- **Expo Push Notifications** (`expo-server-sdk`) — `src/service/pushNotificationService.js`
  - Tipos de evento válidos: `encomenda`, `reuniao`, `aviso`, `ocorrencia`, `financeiro`, `visitante`
- **Vercel Blob** (`@vercel/blob`) — armazenamento de avatares/imagens de consumo/dashboard
- **emailDispatchService** — envia para URL externa configurada em `EMAIL_DISPATCH_URL`; retry automático 3× em erros 5xx, sem retry em 4xx
- **bcryptjs** — hash de senhas
- **node-fetch** — chamadas HTTP internas
- **node-cron** — agendamento do lembrete de reservas (carregado em `server.js`)

## Variáveis de ambiente relevantes

| Variável | Uso |
|---|---|
| `JWT_SECRET` | Assina/verifica tokens JWT |
| `DB_HOST_SQL_POSTGRE` | Host PostgreSQL |
| `PORTA_SQL_POSTGRE` | Porta PostgreSQL |
| `USER_SQL_POSTGRE` | Usuário PostgreSQL |
| `PASSWORD_SQL_POSTGRE` | Senha PostgreSQL |
| `DATABASE_POSTGRE` | Nome do banco |
| `PUBLIC_REGISTRATION_KEY` | Chave para registro público de moradores |
| `SERVICE_INVITE_TOKEN_SECRET` | Secret para tokens de convite |
| `EMAIL_DISPATCH_URL` | URL do serviço de despacho de e-mails |
| `PUBLIC_EMAIL_DISPATCH_KEY` | Bearer token do serviço de e-mails |

## Convenções

- Controllers são classes; métodos públicos terminam com `.bind(controller)` nas rotas.
- Métodos auxiliares privados do controller começam com `_` (ex: `_toInt`, `_parseDataAgendamento`, `_normalizarPerfil`).
- Datas aceitam formato ISO 8601 ou `dd/mm/aaaa` — parsing centralizado em `_parseDataAgendamento()` (CondominioController) e `_parseDataHora()` (ReuniaoController).
- Paginação padrão: `page` + `pageSize` como query params; sem eles retorna todos os registros.
- Operações com efeitos colaterais assíncronos (push, e-mail) são disparadas via `setImmediate()` após a resposta HTTP já ter sido enviada.
- Soft delete em reuniões: `DELETE /api/reuniao/:id` muda status para `CANCELADA`, não remove o registro.
