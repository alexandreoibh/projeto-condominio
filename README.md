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
- `POST /api/condominio/usuarios` - cria usuário (`Authorization: Bearer <token>`)
- `POST /api/condominio/espacos` - cadastra espaço (`Authorization: Bearer <token>`)
- `PUT /api/condominio/espacos/:id` - edita espaço por id (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/:id` - busca espaço por id (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos?page=1&pageSize=10&orderBy=nome&ativo=true` - lista paginada (use `orderBy=nome` para ordenar alfabeticamente e `ativo=true|false` para filtrar) (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/agenda?data_inicio=01/03/2026&data_fim=31/03/2026` - lista salas reservadas por período (filtros opcionais: `id_espaco`, `status`, `data_agendamento`, `data_inicio`, `data_fim`; datas em ISO ou `dd/mm/aaaa`). Ao informar período e não informar `status`, retorna apenas `andamento` e `aprovado`. `page` e `pageSize` são opcionais; sem eles retorna todos os registros do filtro (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/agenda?aba=em_andamento` - lista reservas para aba **Em andamento** (`pendente` e `andamento`) usando a mesma tabela (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/agenda?aba=concluidos` - lista reservas para aba **Concluídos** (`aprovado` e `reprovado`) usando a mesma tabela (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/agenda/minhas?page=1&pageSize=10&id_espaco=13&status=pendente&data_agendamento=19/03/2026` - lista minhas reservas (filtros opcionais: `id_espaco`, `status`, `data_agendamento` em ISO ou `dd/mm/aaaa`) (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/agenda/minhas?aba=em_andamento` - lista minhas reservas da aba **Em andamento** (`pendente` e `andamento`) (`Authorization: Bearer <token>`)
- `GET /api/condominio/espacos/agenda/minhas?aba=concluidos` - lista minhas reservas da aba **Concluídos** (`aprovado` e `reprovado`) (`Authorization: Bearer <token>`)
- `POST /api/condominio/espacos/:id/agenda` - agenda/reserva uma sala (`Authorization: Bearer <token>`)
- `DELETE /api/condominio/espacos/:id` - exclui espaço por id (`Authorization: Bearer <token>`)

Nos endpoints protegidos, o `id_condominio` é obtido pelo token JWT (não precisa enviar no body).

### Login (produção)

`POST /api/login`

Body JSON:

```json
{
	"login": "email@condominio.com ou 12345678901",
	"password": "sua_senha"
}
```

`login` aceita CPF (apenas números) ou e-mail.

## Compatibilidade

- Login disponível apenas via `POST /api/login`.
- O bootstrap principal agora conecta no PostgreSQL ao iniciar.
