# Backend Condomínio (Node.js + Express + PostgreSQL)

Base refatorada para reaproveitar o projeto em um novo backend de condomínio, com foco em PostgreSQL.

## Pré-requisitos

- Node.js 18+
- PostgreSQL ativo

## Variáveis de ambiente

Crie um arquivo `.env` na raiz com:

```env
PORT=3001

DB_HOST_SQL_POSTGRE=localhost
PORTA_SQL_POSTGRE=5432
USER_SQL_POSTGRE=postgres
PASSWORD_SQL_POSTGRE=postgres
DATABASE_POSTGRE=condominio

JWT_SECRET=troque_essa_chave_em_producao
```

## Executar

```bash
npm install
npm start
```

## Endpoints principais

- `GET /api/health` - healthcheck da API
- `POST /api/login` - login principal
- `GET /api/condominio/status` - status do módulo condomínio
- `GET /api/condominio/moradores` - lista moradores (`Authorization: Bearer <token>`)

### Login (produção)

`POST /api/login`

Body JSON:

```json
{
	"login": "email@condominio.com",
	"password": "sua_senha"
}
```

## Compatibilidade

- Rota legada `GET /api/login?dt1=<login>&dt2=<senha>` continua disponível temporariamente.
- Rotas legadas continuam disponíveis também em `/login`.
- O bootstrap principal agora conecta no PostgreSQL ao iniciar.
