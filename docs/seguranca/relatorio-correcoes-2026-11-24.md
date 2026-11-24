# Correções de segurança pós-incidente: backend e-Morador

- **Data:** 24/11/2026
- **Contexto:** incidente de 22–23/11/2026. O Admin ID 56 (condomínio 282) foi comprometido pela recuperação de senha da v2.57. Houve arquivos suspeitos no Vercel Blob (`sh.php`, `xxe.svg`, `slip.docx`) e reuniões "RCE"/"RCE2".
- **Status:** tudo está **implementado e testado só no working tree local**.
  - Nenhum commit, push ou deploy foi feito.
  - Nenhum SQL rodou em produção e nenhuma credencial foi rotacionada.
  - Os arquivos do Blob não foram acessados.
- **Testes:** `npm test` → **9 suítes, 188 testes, todos passando**. Os testes usam banco simulado e a rede fica bloqueada.

---

## 1. Correções por item

### P0 — Críticas

| # | Correção | Arquivos | Teste |
|---|---|---|---|
| 1 | **Blob (C1).** O download de anexo de reunião aceitava `<store>...com.atacante.tld` e `...com@atacante.tld`, e enviava o `BLOB_READ_WRITE_TOKEN` ao atacante. Agora valida pelo host exato (`parseUrlBlob`), exige HTTPS, recusa userinfo e porta, confere pathname e condomínio do token, exige um anexo cadastrado na reunião, usa `redirect: 'error'` e responde com Content-Type fixo, `attachment` e `nosniff`. Os proxies de avatar, consumo e dashboard só servem o caminho da própria área (`/condominios/<id>/usuarios/<id>/avatar/…`, `…/consumo/registros/…/imagem/…`, `…/dashboard/registros/tipo<N>/<id>/imagem/…`) com extensão de imagem, `redirect: 'error'` e Content-Type fixo. `path_avatar`, `origem_imagem` e `origem` vindos do body só são aceitos se forem caminhos válidos (senão, o campo é ignorado e o valor atual é mantido; ver seção 7, item 5). `cobrar` só assina `anexos_urls` de `cobranca/boletos/condominio-<id do token>/`. | `helpers/blobUrl.js` (`validarUrlBlobDoCondominio`, `buscarBlobPrivado`, `enviarArquivoBlob`), `helpers/avatarProxy.js`, `reuniaoController.downloadAnexoReuniao`, `condominioController` (3 proxies e `_erroCaminhoImagemBody` em 8 handlers), `financeiroController.cobrar` | `incidente-2026-11-24` › C1 (6 URLs maliciosas → 400 sem `fetch`; anexo não cadastrado → 403; anexo válido → tipo fixo e sem redirect), `uploads-exposicao` |
| 2 | **JWT sem `token_version`** é recusado: o claim `tv` precisa ser inteiro e igual ao do banco. Isso pega tokens anteriores ao hardening, de deployments antigos e de "deploy v2.57". Se a coluna estiver ausente, a resposta é **503** (antes, a checagem era pulada). Vale para todas as rotas, porque todas passam por `verificarTokenDeSessao`. | `helpers/auth.js`, `helpers/sessao.js` | JWT sem `tv` → 401; coluna ausente → 503 |
| 3 | **Revogação de sessão** em mudança de senha, perfil, status, e-mail, CPF e `id_condominio`, na **mesma transação** da alteração. Trocar o **próprio** e-mail ou CPF passa a exigir `senha_atual`, porque o e-mail recebe o código de recuperação. | `condominioController._autorizarEdicaoUsuario` e `editarUsuario` | e-mail sem senha → 422; com senha → 200 e `token_version` incrementado dentro da transação |
| 4 | **Isolamento entre condomínios.** O perfil 1 deixou de ser global. Só os ids em `SUPERADMIN_USER_IDS` atuam entre condomínios; os outros Admins ficam no condomínio do token. As 27 ocorrências de `ehAdmin = IdPerfil === 1` e as 8 de `permissoes.ehAdmin` foram trocadas por `ehSuperAdmin`. Ficam só para super-admin: criar condomínio, menu de perfis (global), tipos de dashboard, push de teste, instância WhatsApp e avatar de outro condomínio. | `helpers/permissoes.js` (`ehSuperAdmin`, `escopoCondominio`, `exigirSuperAdmin`), `condominioController`, `manutencaoController`, `financeiroController`, `routes/condominio.js`, `usuario.js`, `whatsapp.js` | Admin local: `/usuarios/base` de outro condomínio → 403; criar condomínio e alterar menu → 403 |
| 5 | **Criar ou promover Admin** é exclusivo do super-admin. **Credenciais bancárias:** conectar Inter/Itaú/Bradesco, alterar multa e juros e desativar a integração exigem perfil 1 ou 3 **e** `senha_atual` (reautenticação). Falhas vão para a auditoria. | `helpers/permissoes.podeAtribuirPerfil`, `helpers/reautenticacao.js` (novo), `routes/integracaoBancaria.js` | Admin local cria Admin → 403; Sub-Síndico → 403; sem senha → 422; senha errada → 422 e auditoria |
| 6 | **Telegram:** a URL vem de `TELEGRAM_WEBHOOK_URL` (https). O `webhook_url` do body é ignorado. Só super-admin configura, e a ação é auditada. | `condominioController.configurarWebhookTelegram`, `routes/condominio.js` | Admin local → 403 sem `fetch`; o body com `evil.tld` é ignorado |
| 7 | **Uploads.** OOXML agora exige `[Content_Types].xml` e leitura do *central directory* do ZIP. São recusadas entradas com `..`, `/` inicial, `\`, drive, caracteres de controle e entradas cifradas (Zip Slip, como `slip.docx`). O nome gravado (`nome_arquivo`) sempre termina na extensão detectada: `sh.php` enviado como PDF vira `sh_php.pdf`. Todas as rotas multer já passavam por `validarUploads`: SVG, PHP e HTML continuam recusados e o nome no Blob é gerado pelo servidor. | `helpers/uploadPolicy.js` | DOCX legítimo é aceito; ZIP com `../` → recusado; ZIP sem Content_Types → recusado; nomes |
| 8 | **Dados pessoais por perfil.** Morador vê de terceiros só id, nome, unidade, bloco, avatar e perfil. Portaria e Colaborador veem também o telefone. Gestão (1/3/4) e o próprio usuário veem tudo. Aplicado em `/usuarios/base`, `/moradores`, `/usuarios`, `/usuarios/condominio/:id`, `/usuarios/por-perfis`, `/relatorios/usuarios` e `GET /usuarios/:id`. | `condominioController._projetarUsuarioPorPerfil` | PII por perfil |

### P1 — Altas

| # | Correção | Arquivos | Teste |
|---|---|---|---|
| 9 | **Permissões por módulo:** escrita de reuniões (criar, editar, parcial, cancelar, anexos) só para gestão. Regulamentos (criar, editar, excluir) só gestão. Editar aceite de regulamento só gestão; excluir aceite, só o dono ou a gestão. Criar e editar espaços só gestão. Escrever leitura de consumo só 1/3/4/5/54. WhatsApp e Telegram para terceiros só gestão ou Portaria. Push de teste só super-admin. | `routes/reuniao.js`, `routes/condominio.js`, `condominioController` (aceite, fila) | 12 rotas com morador → 403; Portaria passa no consumo |
| 10 | **Rate limit.** No login, o usuário é resolvido primeiro e as falhas contam por `id_usuario`, então e-mail e CPF somam juntos (fecha o desvio por CPF). Se a consulta falhar, o login é **recusado (503)**. O CPF vazio não casa mais com e-mail sem dígitos. Na recuperação, além das 5 tentativas por desafio, há limite de 20 por IP e 300 globais a cada 15 min no verify (fail closed). O cadastro por convite usa o IP confiável. | `loginController`, `condominioController` (`_verificacaoCodigoExcedeuLimite`, `_resolveRequestIp`) | identidade normalizada; 503; CPF vazio |
| 11 | **Primeiro acesso e senha legada:** o login aceita **só bcrypt**. `NULL`, `''`, marcadores como `'RESET'` e senha legada em texto puro **nunca autenticam**; o caminho é "Esqueci minha senha". A migração automática do texto puro foi removida. Não existe endpoint de "primeiro acesso". | `loginController`, `condominioController._senhaConfere` | 4 casos de `senha_hash` |
| 12 | **JWT fora da URL:** a sessão só é aceita em header (`Authorization: Bearer`, `x-access-token` ou `token`). O `?token=` continua valendo **só** para tokens de imagem (`aud: image`, 5 min). | `helpers/auth.js` | `?token=` e body → 401 |
| 13 | **Auditoria nova** (`tb_auditoria_seguranca`, sem segredos): `usuario_criado` (gestão e convite), `usuario_cpf_alterado`, `recuperacao_solicitada`, `recuperacao_codigo_validado`, `recuperacao_codigo_falho`, `reuniao_criada`, `reuniao_editada`, `reuniao_cancelada`, `reuniao_anexo_enviado`, `reuniao_anexo_removido`, `menu_permissoes_alteradas`, `telegram_webhook_configurado`, `condominio_criado`, `condominio_editado`, `fatura_plano_alterado`, `mensagens_lote_enfileiradas`, `avatar_enviado`, `leitura_cross_tenant`, `reautenticacao_falhou`. A falha ao gravar o log de acesso agora aparece no `console.error`. | controllers, `helpers/reautenticacao.js` | auditoria de reautenticação e recuperação |
| 14 | **IP real:** só loopback e `TRUSTED_PROXY_IPS` podem informar o IP do cliente. Dispositivo, SO, navegador e localização declarados só valem vindos do proxy confiável; de cliente direto, vêm do User-Agent e o valor declarado (ex.: `x/x/x`) vai para `mensagem` como `cliente_declarado=`. | `loginController._registrarLogAcesso` | dispositivo `x` não vai para as colunas |
| 15 | **Atomicidade:** `recoveryReset` grava `senha_hash` e `token_version + 1` **no mesmo UPDATE**. `editarUsuario` incrementa a versão dentro da transação. | `condominioController` | reset revoga; e-mail revoga na transação |

### Migrations
- `20261123000001`: a correção do `ABLE` já está no commit `36e1a87` (v2.63). Um teste executa o `up()` com um `queryInterface` falso e verifica o SQL gerado.
- Nenhuma migration nova é necessária: os limites usam `tb_auditoria_seguranca` e `tb_sgw_log_acesso`.

### Testes
- Novo: `tests/incidente-2026-11-24.test.js` (48 testes).
- Atualizados: `auth.test.js` (senha legada, rate limit, log), `uploads-exposicao.test.js` (área obrigatória no proxy), `helpers/fakeDb.js` (incremento atômico), `setup-mocks.js` (**rede bloqueada**: `node-fetch` e `fetch` falham, salvo mock explícito).
- **Ocorrência:** durante a escrita da suíte, **uma** execução enviou uma requisição real a `api.telegram.org`, com token de bot fictício (`bot-teste`) e URL `api.emorador.test`, recusada pelo Telegram. Nenhum segredo real foi envolvido. A causa (o `node-fetch` não estava mockado) foi corrigida no setup global.

---

## 2. Arquivos alterados (working tree, sem commit)

**Modificados:**
- `src/controllers/`: `condominioController.js`, `financeiroController.js`, `loginController.js`, `manutencaoController.js`, `reuniaoController.js`.
- `src/helpers/`: `auth.js`, `avatarProxy.js`, `blobUrl.js`, `permissoes.js`, `sessao.js`, `uploadPolicy.js`.
- `src/routes/`: `condominio.js`, `integracaoBancaria.js`, `reuniao.js`, `usuario.js`, `whatsapp.js`.
- `tests/`: `auth.test.js`, `helpers/fakeDb.js`, `setup-mocks.js`, `uploads-exposicao.test.js`.
- `CLAUDE.md`.

**Novos:**
- `src/helpers/reautenticacao.js`
- `tests/incidente-2026-11-24.test.js`
- `src/database/sql/incidente-2026-11-revogacao-e-reset.sql`
- este relatório.

**Pendente de push:** o commit `e29c442` (remoção de `GET /planos/publicos`) e os seus `ccd612f` e `36e1a87`.

---

## 3. Impacto no frontend (PHP e app)

1. **JWT só em header.** Toda chamada que hoje manda a sessão em `?token=` ou no body (`token`) passa a receber 401. É preciso usar `Authorization: Bearer <jwt>`. As URLs de imagem geradas pelo backend (`…/avatar?token=…`, com token de imagem) continuam funcionando.
2. **Trocar o próprio e-mail ou CPF** em `PUT /usuarios/:id` exige `senha_atual`. Respostas: 422 `current_password_required` e 422 `current_password_invalid`.
3. **Integração bancária:** conectar, `PUT /:id` e `DELETE /:id` exigem `senha_atual` no body (ou no multipart) e perfil Admin ou Síndico.
4. **Morador** recebe 403 ao escrever em reunião, regulamento, aceite (edição), espaço ou consumo, e ao enfileirar WhatsApp/Telegram para outra pessoa.
5. **Listagens de usuários** para perfis que não são de gestão vêm com campos reduzidos (sem CPF, e-mail, telefone, nascimento ou endereço de terceiros).
6. `path_avatar`, `origem_imagem` e `origem` no body só são aceitos se vierem do upload do sistema; senão, o valor é **ignorado** (mantém o atual), sem erro.
7. **Senha legada em texto puro** não entra mais. Esses usuários usam "Esqueci minha senha" (contagem na consulta 0c do SQL).
8. **Admin que não é super-admin** perde o acesso entre condomínios e as configurações globais.
9. **Login** pode responder 503 se o banco do rate limit falhar. O app deve tratar isso como "tente novamente".
10. **Anexos de reunião** passam a ser baixados como `attachment`.
11. **P2 — crons PHP:** os 4 crons que fazem login com a senha antiga do Admin **já falham** depois do reset do ID 56. A credencial de serviço depende da lista exata de chamadas, ainda pendente.

---

## 4. Variáveis de ambiente novas

| Variável | Uso |
|---|---|
| `SUPERADMIN_USER_IDS` | Ids (separados por vírgula) dos super-admins da plataforma. Sem ela, nenhum Admin atua entre condomínios. |
| `TELEGRAM_WEBHOOK_URL` | URL https oficial do webhook (ex.: `https://back-projeto-condominio.vercel.app/api/condominio/telegram/webhook`). |

---

## 5. Sequência de publicação e rotação (executar só com autorização)

1. **Preparação, sem impacto:**
   - fazer backup (`pg_dump` de `tb-usuarios` e `tb_recovery_tokens`);
   - rodar as consultas **0a–0d** de `incidente-2026-11-revogacao-e-reset.sql` e corrigir os contatos adulterados;
   - definir `SUPERADMIN_USER_IDS` e `TELEGRAM_WEBHOOK_URL` na Vercel.
2. **Front pronto:** PHP e app usando JWT só em header, `senha_atual` nas telas bancárias e de e-mail/CPF, e tratamento de 403/422/503. Publicar junto com o passo 4.
3. **Rotação na Vercel** (os valores novos só valem no deploy seguinte):
   - `JWT_SECRET` (derruba todas as sessões e links assinados);
   - `SERVICE_INVITE_TOKEN_SECRET` (diferente do JWT);
   - `BLOB_READ_WRITE_TOKEN` e `BLOB_PRIVATE_READ_WRITE_TOKEN`;
   - `TELEGRAM_WEBHOOK_SECRET` (e `TELEGRAM_BOT_TOKEN`, se `getWebhookInfo` mostrar URL alterada);
   - `CRON_QUEUE_KEY` e `PUBLIC_REGISTRATION_KEY`, atualizando o PHP ao mesmo tempo;
   - `PUBLIC_EMAIL_DISPATCH_KEY`/`PUBLIC_WHATSAPP_DISPATCH_KEY`, se o relatório do front indicar exposição.

   Rotacionar os tokens do Blob **só junto com o deploy do C1**. Antes disso, o token novo vaza do mesmo jeito.
4. **Commit e push** dos itens deste relatório, com a sua autorização. O deploy da Vercel já sobe com o código novo e os segredos novos.
5. **Deployments antigos:** apagar todos os anteriores à v2.58 ou ativar Deployment Protection. Eles têm a recuperação vulnerável e o segredo antigo.
6. **SQL:** rodar o bloco 1 de `incidente-2026-11-revogacao-e-reset.sql` (revogação global, reset de 10/12/56/95 e encerramento das recuperações). Esperar 60 s e rodar o bloco 2 (conferência).
7. **Telegram:** o super-admin chama `POST /api/condominio/telegram/configurar-webhook` e confere com `getWebhookInfo`.
8. **Smoke test:**
   - `curl` com `?url=` de `.evil.tld` → 400;
   - JWT antigo → 401;
   - `/planos/publicos` → 404;
   - login normal → 200;
   - cadastro por convite com a chave nova → OK.
9. **Usuários 10, 12, 56 e 95:** redefinir pela recuperação, no e-mail conferido. Para o 56, confirmar por canal externo.

---

## 6. Riscos residuais

- **Crons PHP (P2):** sem credencial de serviço, as 4 rotinas param depois do reset. Aguardando a lista exata.
- **`recoveryRequest`** ainda devolve `user_id`, o que permite enumerar usuários. Mantido por compatibilidade com o app.
- **Proxies de imagem** aceitam qualquer `*.blob.vercel-storage.com`. O token só vai para a infraestrutura da Vercel, o caminho é restrito à área e o Content-Type é fixo, mas um store de terceiro na Vercel poderia ser lido com o nosso token.
- **Revogação** leva até 60 s por instância (cache).
- **Auditoria** é *best effort*: uma falha não bloqueia a operação e aparece só no `console.error`. O usuário de banco da aplicação pode alterar e apagar a `tb_auditoria_seguranca`. Recomendado: grants separados ou log drain.
- O limite do verify depende dos INSERTs de auditoria. Se eles falharem, valem só as 5 tentativas por desafio.
- **CPF alterado** via `/usuarios/me/baixar-boleto` não revoga a sessão (é auditado). A tela corrige CPF técnico legado, e o CPF não recebe código de recuperação.
- **Admin local** continua com poderes amplos **dentro** do próprio condomínio (é o papel dele). Ações sensíveis estão auditadas.
- **JWT** com PII, validade de 1 dia e sem refresh token.
- `INVITE_TOKEN_MAX_USES` e o rate limit do convite continuam em memória.
- **Dependências:** `multer` 1.x, `pdfkit`, `axios` 0.21 (ver relatório de 23/11).
- **Frontend PHP:** upload sem autenticação efetiva, exposição de JWT, XSS e Router, conforme o relatório do front. Não está coberto por este repositório.

---

## 7. Revisão pré-publicação (24/11/2026, segunda rodada)

`npm test`: **9 suítes, 188 testes passando**. Rede totalmente bloqueada.

| # | Ponto revisado | Resultado |
|---|---|---|
| 1–3 | P2: chaves de serviço dos crons | **Pendente.** Aguarda o relatório dos 4 crons. O desenho previsto é uma chave por rotina (`X-Service-Key`), com allowlist de método e rota e `authTipo = 'servico'` sem `IdPerfil`. Assim a chave não consegue fazer login, criar usuário, trocar senha nem acessar rota fora da lista. |
| 4 | Escopo de condomínio | Revisado nos handlers alterados. Admin local recebe 403 ou resultado filtrado em `/usuarios/base`, `/usuarios/condominio/:id`, `/condominios/:id` e `/manutencao/rotinas` de outro condomínio. O super-admin (allowlist) consegue consultar outros condomínios. |
| 5 | App mobile (`29_ProjetoAppCondominio`) | Usa `Authorization: Bearer` (`services/api.ts:24`), então não é afetado pelo bloqueio de `?token=`. Recebe `tv` no login e não usa refresh. A troca de senha já envia `senha_atual`. O upload de avatar é multipart com o próprio `id_condominio`, e os downloads usam header. **Ajustes feitos para não quebrar o app:** `MeusDadosModal.tsx:205` reenvia `path_avatar` e `ocorrenciasService.ts:79/117` envia `origem`; um valor fora do padrão agora é **ignorado** (o valor atual é mantido e a ação vai para a auditoria como `caminho_imagem_ignorado`) em vez de 422. **Pendência:** trocar o próprio e-mail pelo app exige `senha_atual`, campo que a tela não tem. Até a tela ganhar esse campo, a troca de e-mail no app recebe 422. |
| 6 | Senha `NULL` ou inválida | Testado com `NULL`, `''`, `'RESET'` e texto puro legado. O login nunca autentica. A recuperação funciona (elegível por status, condomínio e e-mail), o código vai **só** para o e-mail do banco (um `email` no body é ignorado), e o reset grava bcrypt e incrementa `token_version` no mesmo UPDATE. |
| 7 | Senha atual incorreta | Agora **422** `current_password_invalid` em `PUT/PATCH /usuarios/:id` e na reautenticação bancária. Nunca 401, que o app trataria como sessão expirada. |
| 8 | XXE, ZIP bomb, Zip Slip, poliglotas | **ZIP:** recusa ZIP64, mais de 5.000 entradas, mais de 100 MB descomprimidos, razão acima de 100:1, entradas cifradas e caminhos com `..`, `/`, `\` ou drive. **XML:** partes `.xml`/`.rels` são infladas com teto e recusadas se tiverem `<!DOCTYPE`/`<!ENTITY`. **Office:** recusa `vbaProject.bin` e `activeX/`. **Poliglotas:** fora de certificados, recusa arquivos com `<?php`, `<?=`, `<script`, `<html`, `<svg` ou shebang. **PDF:** recusa `/JavaScript`, `/JS`, `/Launch` e `/EmbeddedFile`. O Node não faz parse de XML nem extrai ZIP em nenhum lugar. |
| 9 | Segredos no diff | Varredura do `git diff --cached` (JWT, `vercel_blob_rw_`, `npg_`, bcrypt, PEM e atribuições literais de secret/token/senha): **nenhum**. O `.env` está no `.gitignore` e nunca foi versionado. |
| 10 | SQL de revogação | Revisado e não executado. Ganhou `SET LOCAL lock_timeout/statement_timeout` e uma trava `DO $$ … RAISE EXCEPTION` se o reset não afetar exatamente 4 usuários. |
| 11 | Auditoria | `_sanitizar` omite por chave (senha, token, secret, chave, hash, authorization, cookie, jwt, api_key, credencial, client_id, private) e **por valor** (JWT, bcrypt, `vercel_blob_rw_`, `Bearer …`, PEM, Buffer). Um teste confirma que nenhuma escrita no banco contém a senha digitada nem o `client_secret`. |
| 12 | Testes sem rede | `fetch` nativo, `node-fetch`, `axios` e `https.request/get` são sempre bloqueados; `http.request` só passa para loopback (supertest). Há teste para cada um. |

---

## 8. Pacote operacional

### 8.1 Variáveis de ambiente na Vercel (só nomes)

**Obrigatórias (Production):**

| Variável | Observação |
|---|---|
| `JWT_SECRET` | Nova, aleatória com 48 bytes ou mais. Diferente de todas as outras. |
| `SERVICE_INVITE_TOKEN_SECRET` | Nova. Diferente do `JWT_SECRET`. |
| `DB_HOST_SQL_POSTGRE`, `PORTA_SQL_POSTGRE`, `USER_SQL_POSTGRE`, `PASSWORD_SQL_POSTGRE`, `DATABASE_POSTGRE` | Neon. **Rotacionar a senha** (corta os deployments antigos). |
| `DB_SSL_CA` / `DB_SSL_SERVERNAME` | Se o Neon exigir. |
| `BLOB_STORAGE_URL` | Sem barra final. |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_PRIVATE_READ_WRITE_TOKEN` | Novos (ver 8.3). |
| `BLOB_UPLOAD_ENV` | `prod`. |
| `INTEGRATION_ENCRYPTION_KEY` | Manter. Rotacionar só com plano de recifragem. |
| `CRON_QUEUE_KEY`, `PUBLIC_REGISTRATION_KEY` | Novas. Atualizar o PHP ao mesmo tempo. |
| `EMAIL_DISPATCH_URL`, `PUBLIC_EMAIL_DISPATCH_KEY`, `ENCOMENDA_ENTREGA_EMAIL_URL` | Rotacionar a chave se o relatório do front indicar exposição. |
| `APP_URL`, `PUBLIC_API_BASE_URL` | URLs oficiais. |
| `SUPERADMIN_USER_IDS` | **Nova.** Ids dos super-admins da plataforma. |

**Condicionais:**
- **Telegram:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (novo) e `TELEGRAM_WEBHOOK_URL` (**nova**, https).
- **WhatsApp:** `WHATSAPP_DISPATCH_URL`, `PUBLIC_WHATSAPP_DISPATCH_KEY`.
- **Outras:** `TRUSTED_PROXY_IPS` (IP do servidor PHP), `WEBHOOK_BANCARIO_SECRET`, `ALLOWED_INVITE_BASE_URLS`, `CORS_ORIGINS`.
- **P2 (futura):** `SERVICE_KEY_RELATORIOS`, `SERVICE_KEY_RESERVA`, `SERVICE_KEY_APROVACAO`, `SERVICE_KEY_MANUTENCAO`.

**Não definir em produção, ou remover:**
- `EXPOR_DETALHE_ERRO=true` e `DB_SSL_REJECT_UNAUTHORIZED=false`;
- legados `EMORADOR_READ_WRITE_TOKEN`, `VERCEL_BLOB_READ_WRITE_TOKEN` e `INVITE_TOKEN_SECRET`;
- `SWAGGER_*`;
- MySQL/Seleme/Sisvenda (`DB_HOST_SQL`, `DB_HOST_SELEME`, `DB_HOST_SISVENDA`, `USER_SQL*`, `PASSWORD_SQL*` e afins), `SENDGRID_API_KEY*`, `POSTMARKAP_API_KEY`, se não forem usados.

Defina os valores em **Production, Preview e Development** separadamente. Preview e Development **não** podem reutilizar os segredos de produção.

### 8.2 Ordem de implantação (frontend e backend)

1. **Preparação, sem impacto:**
   - fazer backup (`pg_dump` de `tb-usuarios` e `tb_recovery_tokens`);
   - rodar as consultas 0a–0d do SQL e restaurar os contatos adulterados.
2. **Frontend PHP compatível com os dois backends:** JWT só em header, `senha_atual` nas telas bancárias e de e-mail/CPF, tratamento de 422 (`current_password_*`), 429 e 503. Publicar **antes**, porque funciona com o backend atual.
3. **App mobile:** nenhuma publicação obrigatória. Planejar o campo `senha_atual` na troca de e-mail.
4. **Rotação:**
   - senha do banco no Neon;
   - na Vercel, os segredos do item 8.1;
   - os tokens novos do Blob (os antigos continuam ativos até o passo 7).
5. **Backend:** push da branch `security/hardening-2026-11-24`, merge e deploy de produção. Os segredos novos e o código novo entram juntos.
6. **Deployments antigos:** apagar ou proteger (8.5).
7. **Blob:** revogar os tokens antigos.
8. **SQL:** bloco 1, espera de 60 s e bloco 2.
9. **Telegram:** o super-admin chama `configurar-webhook` e confere com `getWebhookInfo`.
10. **Smoke tests:**
    - `?url=` de `.evil.tld` → 400;
    - JWT antigo → 401;
    - `/planos/publicos` → 404;
    - login → 200;
    - convite com a chave nova;
    - upload e download de anexo.
11. **P2:** depois de implementada, publicar as chaves de serviço e ajustar os crons (até lá, eles ficam parados).

### 8.3 Rotação e revogação do token do Blob

1. Vercel → Storage → (store privado e público) → **Tokens** → criar token *read-write* novo.
2. Atualizar `BLOB_READ_WRITE_TOKEN` e `BLOB_PRIVATE_READ_WRITE_TOKEN` (Production; Preview e Development com tokens próprios).
3. Publicar **no mesmo deploy** da correção C1. Antes dela, o token novo vazaria do mesmo jeito.
4. Validar: upload e download de anexo, avatar e boleto.
5. **Revogar** os tokens antigos no painel. Os deployments antigos perdem o acesso ao store.
6. **Auditoria do store**, sem baixar nem abrir arquivos: listar pathnames (painel ou `list()` somente leitura) e separar os que fogem do padrão `<env>/condominios/<id>/<area>/…/<ts>_<rand>.<ext>`, `…/imagem/vN.<ext>` ou `cobranca/boletos/condominio-<id>/…`. É o caso de `sh.php` e `xxe.svg`. Mover para quarentena ou excluir só depois da análise.

### 8.4 Invalidação de JWTs antigos

São três camadas independentes:
1. **Código:** o JWT sem `tv` é recusado. Isso inclui tudo o que foi emitido antes do hardening e pelos deployments antigos.
2. **`JWT_SECRET` novo:** toda assinatura anterior fica inválida, inclusive tokens forjados, tokens de deployments antigos e links de boleto assinados.
3. **SQL:** `token_version + 1` global derruba os JWTs que tinham `tv` válido.

Há uma margem de até 60 s (cache por instância). Depois disso, todos os usuários precisam fazer login de novo. Os tokens de convite caem com o `SERVICE_INVITE_TOKEN_SECRET` novo, e as recuperações pendentes são encerradas pelo SQL (1c).

### 8.5 Deployments antigos da Vercel

- **Por que são perigosos:** cada deployment guarda o código **e uma cópia das variáveis do momento do build**. Um deployment da v2.57 continua no ar pela URL `*-<hash>.vercel.app`, com a recuperação vulnerável, o `JWT_SECRET` antigo, a senha do banco antiga e o token do Blob antigo.
- **O que fazer:**
  1. **Settings → Deployment Protection → Standard Protection** (ou *All Deployments*, se o plano permitir): as URLs geradas passam a exigir login na Vercel, e só o domínio de produção fica público.
  2. **Remover** todos os deployments anteriores à v2.58 (painel → Deployments → ⋯ → Delete, ou `vercel remove <url> --safe`), e de preferência todos os anteriores a este deploy.
  3. **Rotacionar a senha do banco (Neon) e os tokens do Blob.** É isso que corta de fato o acesso de qualquer deployment antigo que tenha sobrado, já que as variáveis dele não mudam.
  4. Confirmar: um `curl` na URL de um deployment antigo deve dar 401 ou 404.

### 8.6 Plano de rollback sem reativar as falhas críticas

- **Antes de publicar:** anotar o ID do deployment atual (v2.63, que já tem hardening) como alvo de rollback. Os deployments anteriores à v2.58 já terão sido apagados (8.5), então o Instant Rollback não consegue cair num deployment vulnerável.
- **Rollback de código:** Vercel → Instant Rollback para o deployment com hardening anotado. **Não** reverter variáveis de ambiente: os segredos novos continuam valendo, e os JWTs, convites e tokens antigos seguem inválidos.
- **Problema pontual** (ex.: uma tela do PHP quebrou): fazer um commit de correção, ou `git revert` só do trecho específico, na branch de segurança, e publicar de novo. Nunca reverter em bloco o commit de hardening, e nunca reativar:
  - `?token=` para sessão;
  - JWT sem `tv`;
  - senha em texto puro;
  - `startsWith` para URLs do Blob;
  - Admin global;
  - `webhook_url` livre no Telegram.
- **Banco:** as alterações (`token_version`, resets, encerramento de recuperação) são definitivas e **não** têm rollback, nem devem ter. A migration `20261123000001` é compatível com versões anteriores.
- **Blob:** os tokens antigos já estarão revogados. Rollback não os reativa, porque os deployments com hardening usam as variáveis novas.
