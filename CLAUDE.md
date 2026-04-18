# CLAUDE.md — Backend Condomínio

## Visão geral

API REST em **Node.js + Express + PostgreSQL (Sequelize)** para gestão de condomínios.
Porta padrão: `3001`. Prefixo de todas as rotas: `/api`.

## Estrutura de pastas

```
src/
├── app.js                  # Bootstrap Express (rotas, middlewares globais)
├── controllers/            # Lógica de negócio (classe por domínio)
│   └── condominioController.js   # Controlador principal — espaços, moradores, menu, push, fatura, consumo
├── routes/                 # Definição de rotas + validações express-validator
│   ├── condominio.js       # Rotas /api/condominio/*
│   ├── login.js            # Rotas /api/login
│   └── usuario.js          # Rotas /api/usuario/*
├── database/
│   ├── postgres.js         # Instância Sequelize (singleton)
│   ├── config_postgres.js  # Config de conexão lida do .env
│   └── migrations/         # Sequelize migrations
├── helpers/
│   ├── auth.js             # Middleware JWT — popula req.idcliente, req.IdPerfil, req.id_condominio, etc.
│   ├── validate.js         # Middleware express-validator — retorna 422 se houver erros
│   └── avatarProxy.js      # Helpers para URLs de avatar (Vercel Blob)
├── service/
│   └── pushNotificationService.js  # Expo push notifications
└── task/
    └── acoes_tela.js       # Tarefas/ações de tela
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
- `controller.metodo.bind(controller)` — método do `CondominioController`

## Banco de dados

- ORM: **Sequelize** com driver `pg`
- Conexão: instância única em `src/database/postgres.js`
- Queries complexas usam `postgres.query(sql, { replacements, type: QueryTypes.SELECT })`
- Schema principal das tabelas de condomínio: `sgw` (ex: `sgw.tb_sgw_perfil_menu`)

## Integrações externas

- **Expo Push Notifications** (`expo-server-sdk`) — `src/service/pushNotificationService.js`
  - Tipos de evento válidos: `encomenda`, `reuniao`, `aviso`, `ocorrencia`, `financeiro`, `visitante`
- **Vercel Blob** (`@vercel/blob`) — armazenamento de avatares/uploads
- **bcryptjs** — hash de senhas
- **node-fetch** — chamadas HTTP internas

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

## Convenções

- Controllers são classes; métodos públicos terminam com `.bind(controller)` nas rotas.
- Métodos auxiliares privados do controller começam com `_` (ex: `_toInt`, `_parseDataAgendamento`).
- Datas aceitam formato ISO 8601 ou `dd/mm/aaaa` — parsing centralizado em `_parseDataAgendamento()`.
- Paginação padrão: `page` + `pageSize` como query params; sem eles retorna todos os registros.
- Rate limiting de registro público: in-memory (`publicRegistrationAttempts` Map), 5 tentativas / 15 min por IP.

## Executar

```bash
npm install
npm start       # node src/server.js ou similar
```

Healthcheck: `GET /api/health` → `{ status: "ok", service: "backend-condominio" }`
