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

| Perfil | Descrição |
|---|---|
| Admin | Acesso total, gerencia permissões de menu |
| Sindico | Gestor do condomínio |
| Sub-Sindico | Gestor auxiliar |
| Morador | Residente — acesso restrito |
| Portaria | Controle de acesso/visitantes |

Permissões de menu ficam na tabela `tb_sgw_perfil_menu`. O seed inicial está em `src/database/sql/seed-tb-sgw-perfil-menu-inicial.sql`.

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
