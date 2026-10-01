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
│   ├── pdfController.js        # Geração de PDFs
│   └── whatsappController.js   # Instância única global de WhatsApp (Evolution API)
├── routes/
│   ├── condominio.js           # /api/condominio/*
│   ├── login.js                # /api/login
│   ├── usuario.js              # /api/usuario/*
│   ├── recovery.js             # /api/auth/recovery/*
│   ├── reuniao.js              # /api/reuniao/*
│   └── whatsapp.js             # /api/whatsapp/* (fora do prefixo /condominio — registro único, não por condomínio)
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
- `"tb-usuarios".morador_principal` (bool NULL, sem default no banco) marca o responsável direto pela unidade (`id_unidade_predio`). O backend trata `NULL` como `false` (GETs usam `COALESCE`). No máximo 1 principal por unidade: `criarUsuario`/`editarUsuario` desmarcam os demais da mesma unidade na mesma transação (`_desmarcarOutrosPrincipaisDaUnidade`). Portaria (5) e Colaborador (54), e qualquer usuário com status diferente de `ativo`, são sempre `false` (`_resolverMoradorPrincipal`). Inativar um principal remove a flag, e reativar não a devolve. O cadastro por convite grava sempre `false`, porque não resolve a unidade. Na emissão de boleto (`_emitirBoletoBancarioParaReceita` em `financeiroController.js`), o pagador é resolvido por `_resolverPagadorBoleto`, que só considera moradores ativos da unidade da receita com CPF, nesta ordem:
1. o principal da unidade;
2. o `r.id_usuario` (se for da unidade);
3. outro morador, proprietário antes, depois o cadastro mais antigo.

Receita sem `id_unidade` usa o `r.id_usuario`. Sem candidato, registra a falha em `tb_fin_cobranca_bancaria`. O pagador escolhido é gravado em `tb_fin_cobranca_bancaria.id_usuario_pagador`/`pagador_nome` e exposto como `pagador_id`/`pagador_nome`.
- **CPF de usuário:** obrigatório em `cadastrarUsuarioPorConvite` e `criarUsuario`, validado em `_validarCpfCadastro` (dígitos via `src/helpers/cpf.js`). Os erros saem como `{ message, error_code }`:
  - `cpf_required`: 422;
  - `cpf_invalid`: 422;
  - `cpf_in_use`: 409.

  A unicidade é **global**, não por condomínio, porque o login busca por e-mail OU CPF. Não existe mais "CPF técnico" gerado, mas usuários antigos ainda têm CPFs técnicos que não passam nos dígitos. Por isso o `editarUsuario` só valida o CPF quando ele muda; ausente, `null` ou igual ao atual mantém o valor. A duplicidade de e-mail responde 409 com `email_in_use`, exceto no convite, que mantém um 422 genérico.
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
- **Produção roda PostgreSQL 9.2.24** (lançado em 2012, sem suporte oficial desde 2017) — confirmado via `SELECT version()` direto no servidor. Isso bloqueia qualquer recurso introduzido depois do 9.2: **sem** `jsonb` (tipo só existe desde 9.4), **sem** `json_build_object`/`jsonb_build_object` (9.4/9.5), **sem** `ON CONFLICT`/upsert nativo (9.5), **sem** `json_agg`/`jsonb_agg` com todas as variações modernas. Para agregar linhas em JSON, usar o padrão compatível já validado no projeto: `array_to_json(array_agg(row_to_json(subquery_com_alias) ORDER BY ...))` — ver uso em `financeiroController.js` (documentos de despesa) e `condominioController.js` (`listarCondominios`/`buscarCondominioPorId`, unidades por bloco). Antes de usar qualquer função JSON/array nova em SQL raw, testar contra o banco real primeiro (não confiar em docs do Postgres atual).
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

**Vínculo do usuário com a unidade (`tb-usuarios.id_unidade_predio`)** — resolvido por `_resolverUnidadeUsuario()` tanto em `criarUsuario` quanto em `cadastrarUsuarioPorConvite`:
- `id_unidade` explícito precisa ser do condomínio (senão 422); nesse caso, apto e bloco passam a ser os da unidade.
- Sem `id_unidade`, casa `apartamento` + `bloco` com `tb_condominios_unidades`. Se não achar, grava `NULL` sem bloquear o cadastro.
- Até 30/09/2026 o convite não gravava essa coluna.

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
  - Templates conhecidos: `balancete_publicado` (publicação de balancete), `reuniao_convocacao` (convocação de reunião), `reserva_status`/`reserva_lembrete` (reservas de espaço), `encomenda_notificacao` (encomenda registrada no dashboard, para moradores do apartamento), `dashboard_registro_notificacao` (switch "Notificar ... por E-mail" da tela de Registro do Dashboard — ver `docs/dashboard-registro-email-dispatch.md`; regra de destinatários por perfil de quem criou: Morador → Síndico/Sub-Síndico (3, 4); demais perfis → Moradores (2), mesma regra do canal Telegram desta tela)
- **whatsappDispatchService** — envia mensagens de WhatsApp via URL externa configurada em `WHATSAPP_DISPATCH_URL` (endpoint PHP `public-whatsapp-dispatch.php`, que fala com a Evolution API); mesmo padrão de retry do `emailDispatchService`. Payload `{ telefones, mensagem }` — **sem** `id_condominio`, pois existe apenas **uma instância WhatsApp para o sistema inteiro** (não por condomínio). Infraestrutura pronta (`despacharWhatsapp()`), ainda sem chamadas automáticas nos fluxos existentes (convite, cobrança, reunião, lembrete) — integração call-site-a-call-site é trabalho futuro. Persistência do status de conexão fica em `"condominio-bh".tb_whatsapp_instancia` (registro único, sempre `id = 1`), exposta via `GET|POST /api/whatsapp/instancia` (fora do prefixo `/api/condominio`, `whatsappController.js`/`routes/whatsapp.js`).
- **encomendaEntregaEmailService** — envia para URL externa configurada em `ENCOMENDA_ENTREGA_EMAIL_URL` (endpoint PHP dedicado `encomenda-entrega-email.php`, distinto de `public-email-dispatch.php`); mesmo padrão de retry do `emailDispatchService`, reaproveita `PUBLIC_EMAIL_DISPATCH_KEY`. Payload `{ emails, encomenda: { apartamento, bloco, condominio_nome, empresa_entrega, id_registro } }`, sem `template` (o serviço externo só monta o texto e envia). Chamado por `editarDashboardRegistro` (`condominioController.js`) quando um registro de Encomenda (`tipo=3`) transiciona para `status='entregue'` — ver `docs/encomenda-entrega-email-dispatch.md`.
- **Fila de mensagens** (`"condominio-bh".tb_mensagens_fila`, processada pelo cron em `POST /api/condominio/mensagens/fila/processar`):
  - **Canais:** `tipo` ∈ `whatsapp` | `telegram` | `email`. A coluna `assunto` é usada só pelo e-mail (migration `20260930000002`).
  - **E-mail:** despacha pelo template `mensagem_morador` com `{ assunto, texto, remetente_nome, condominio_nome }`. Enfileirar `email` (individual) e usar `POST /mensagens/fila/lote` exige perfil 1/3/4; WhatsApp e Telegram individuais seguem abertos.
  - **Lote:** resolve os usuários ativos por `perfil_ids` e só enfileira os canais viáveis (tem o contato e o canal não foi desativado). A resposta traz os contadores de ignorados.
  - **Retorno do envio:** `despacharEmail` retorna `{ ok, status, message }` e nunca lança erro. A fila usa esse retorno para marcar falha (status 3).
  - **Boas-vindas automáticas:** todo cadastro novo (`criarUsuario` e `cadastrarUsuarioPorConvite`) de perfil 2/3/4 com e-mail enfileira um e-mail (`modulo='boas_vindas'`, texto em `MENSAGEM_BOAS_VINDAS_MORADOR`) via `_enfileirarBoasVindasMorador`.
    - É best effort: uma falha nesse enfileiramento não quebra o cadastro.
    - No convite, o remetente é quem gerou o convite (`id_usuario_criacao` no JWT de `gerarConviteMorador`).
- **Webhook bancário** (`POST /api/webhook/bancario/:provider`, rota pública).
  - **Cadastro no banco:** o webhook **não é cadastrado automaticamente**. Cada conta Inter (sandbox e produção) precisa de `PUT /cobranca/v3/cobrancas/webhook` com `webhookUrl = https://back-projeto-condominio.vercel.app/api/webhook/bancario/inter`. Produção (integração id 1, condomínio 282) foi cadastrada em 01/10/2026. Sem esse cadastro, nenhum pagamento é confirmado automaticamente.
  - **Rede de segurança:** `POST /api/webhook/bancario/reconciliar` (header `X-Cron-Queue-Key`, mesmo `cronQueueKeyGuard` da fila de mensagens) reconsulta no banco as cobranças `emitida` com mais de 30 min. Precisa de **cron externo**, porque o `node-cron` de `src/task/reconciliarCobrancasBancarias.js` não roda na Vercel serverless.
- **Multa/juros no boleto (Inter)** — `tb_fin_integracao_bancaria.multa_percentual` / `juros_mora_percentual_mes` (numeric(5,2), migration `20260929000002`).
  - **Onde são definidos:** obrigatórios no `POST /api/condominio/financeiro/integracao-bancaria/inter/conectar`, e editáveis via `PUT /api/condominio/financeiro/integracao-bancaria/:id` (só esses dois campos; Admin/Síndico/Sub-Síndico).
  - **Validação:** 0–100 com até 2 casas. Valores acima do limite legal (2% / 1% a.m.) são aceitos, mas geram `console.warn('[auditoria-integracao-bancaria] ...')`.
  - **Na emissão:** vão como `multa {codigo:'PERCENTUAL'}` / `mora {codigo:'TAXAMENSAL'}` quando > 0. Integração Inter com algum dos dois NULL **não emite**: registra falha "Configure multa e juros na integração bancária antes de emitir boletos.".
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
| `WHATSAPP_DISPATCH_URL` | URL do serviço de despacho de WhatsApp (`public-whatsapp-dispatch.php`, front PHP/Evolution API) |
| `PUBLIC_WHATSAPP_DISPATCH_KEY` | Bearer token do serviço de WhatsApp — opcional; se ausente, usa `PUBLIC_EMAIL_DISPATCH_KEY` como fallback |
| `ENCOMENDA_ENTREGA_EMAIL_URL` | URL do serviço de e-mail de "encomenda entregue" (`encomenda-entrega-email.php`, endpoint PHP dedicado, separado de `public-email-dispatch.php`) |

## Convenções

- Controllers são classes; métodos públicos terminam com `.bind(controller)` nas rotas.
- Métodos auxiliares privados do controller começam com `_` (ex: `_toInt`, `_parseDataAgendamento`, `_normalizarPerfil`).
- Datas aceitam formato ISO 8601 ou `dd/mm/aaaa` — parsing centralizado em `_parseDataAgendamento()` (CondominioController) e `_parseDataHora()` (ReuniaoController).
- Paginação padrão: `page` + `pageSize` como query params; sem eles retorna todos os registros.
- Operações com efeitos colaterais assíncronos (push, e-mail) são disparadas via `waitUntil` de `@vercel/functions` após a resposta HTTP já ter sido enviada — necessário porque a função serverless (Vercel) pode ser suspensa assim que a resposta é enviada; `setImmediate()` puro não garante execução (ver `README.md` para detalhes).
- **Log de salas:** toda criação, edição com mudança real e exclusão de sala (`criarEspaco`/`editarEspaco`/`excluirEspaco`) grava em `"condominio-bh".tb_espaco_log`, na mesma transação da alteração (migration `20260930000001`).
  - **O que registra:** snapshot de quem alterou (id, nome, e-mail, perfil); o diff em `campos_alterados` (`[{campo, label, anterior, novo}]`, com labels da tela, conforme `ESPACO_CAMPOS_LOG`); e a linha completa antes/depois em `dados_anteriores`/`dados_novos` (TEXT com JSON).
  - **Consulta:** `GET /api/condominio/espacos/:id/logs` e `GET /api/condominio/espacos/logs` (filtros `id_espaco`, `acao`, `id_usuario`, `data_inicio`, `data_fim`), só para perfis 1/3/4. A consulta não faz JOIN com `tb_espaco`, então o histórico sobrevive à exclusão da sala.
- Soft delete em reuniões: `DELETE /api/reuniao/:id` muda status para `CANCELADA`, não remove o registro.
- `id_condominio` normalmente é extraído do token. Exceção: quando o usuário autenticado é Admin (`IdPerfil === 1`), vários endpoints de `condominioController.js` aceitam um `id_condominio` explícito no body/query para operar em nome de outro condomínio ("Admin override").
- A instância de WhatsApp (`whatsappController.js`, `"condominio-bh".tb_whatsapp_instancia`) é **global**, não por condomínio — não segue o padrão de `id_condominio` do token; qualquer usuário autenticado lê/grava o mesmo registro único (`id = 1`).
