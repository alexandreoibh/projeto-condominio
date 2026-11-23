# Relatório de auditoria de segurança: backend e-Morador

- **Data:** 23/11/2026
- **Contexto:** possível incidente em 22/11/2026, IP `177.16.189.223`.
- **Escopo:** este repositório (API Node/Express na Vercel). O frontend PHP não estava disponível localmente.

**Status geral:** as correções foram **implementadas e testadas localmente**, na branch `security/hardening-2026-11-23`, ainda **sem commit**. **Nada foi publicado.** A migration **não foi executada** em nenhum banco. Nenhum dado de produção foi lido ou alterado.

Legenda de status:
- **Implementado + testado:** há teste automatizado cobrindo.
- **Implementado:** sem teste específico.
- **Pendente:** não corrigido.

---

## Resumo executivo

O backend permitia **tomar qualquer conta sem login**, bastando saber o e-mail ou CPF da vítima, e **promovê-la a Admin global**. A cadeia:

1. `POST /api/condominio/auth-recovery-lookup` devolve um token de recuperação válido por 24h, sem pedir código.
2. `PUT /api/condominio/usuarios/:id` com esse token troca a senha e o `tipo_perfil_id` (1 = Admin).
3. Login como Admin, que enxerga todos os condomínios.

Além disso:
- qualquer morador logado podia se tornar Admin;
- um webhook bancário sem autenticação marcava boletos como pagos;
- um endpoint público de download podia entregar o token de leitura/escrita do Vercel Blob a um terceiro.

Todas essas falhas estão corrigidas no código local, com 91 testes automatizados passando. **Elas continuam abertas em produção até o deploy.**

**Não foi possível confirmar se houve exploração.** Não há logs de requisição no backend, e o banco de produção não foi consultado. As consultas para investigação estão em `docs/seguranca/incidente-2026-11-22-consultas.sql`.

---

## A. Vulnerabilidades identificadas

| # | Grav. | Onde | Problema e impacto | Status |
|---|---|---|---|---|
| V1 | Crítica | `condominioController.authRecoveryLookup`; rotas públicas `/api/condominio/auth-recovery-lookup(.php)` e `/service/auth-recovery-lookup` | Devolvia `invite_token`/`token` (JWT `flow: password_recovery`, 24h) a quem informasse e-mail ou CPF, sem OTP. O código gerado nem era enviado. Usuário inexistente gerava 404 (enumeração). **Tomada de conta sem login.** | Implementado + testado |
| V2 | Crítica | `recoveryReset` | Aceitava esse JWT várias vezes por 24h, sem consultar a tabela de tokens. Não revogava sessões. | Implementado + testado |
| V3 | Crítica | `authOrInviteToken` (`routes/condominio.js`) e `editarUsuario` | Qualquer string em `token`/`invite_token` pulava o JWT. Com o token de recuperação, ou com o de convite de morador (este último para usuários sem e-mail), era possível trocar senha, e-mail, CPF, status e `tipo_perfil_id`. `_verifyInviteToken` não conferia a finalidade do token. | Implementado + testado |
| V4 | Crítica | `editarUsuario`, `criarUsuario` | Não havia checagem de perfil. Morador se promovia a Admin, trocava a senha de vizinhos e criava Admins. Síndico também criava Admins. | Implementado + testado |
| V5 | Crítica | `helpers/auth.js` | O token de imagem (avatar, 5 min), assinado com o mesmo segredo, era aceito como sessão do usuário-alvo. Esse token aparece em URLs de listagens. | Implementado + testado |
| V6 | Crítica | `POST /api/webhook/bancario/:provider` | Sem autenticação, e o status vinha do payload. Um evento `PAGO` forjado dava baixa na receita e enviava e-mail de pagamento. A baixa era definitiva, porque a reconciliação ignora boletos pagos. Um `CANCELADO` forjado tirava o boleto da reconciliação. | Implementado + testado |
| V7 | Crítica | `financeiroController.downloadBoletoCobranca` (público) | A validação `startsWith(BLOB_STORAGE_URL)` aceitava `https://<store>.blob.vercel-storage.com.atacante.tld/...`, e o servidor enviava o `BLOB_READ_WRITE_TOKEN` a esse host. Também baixava boletos de qualquer condomínio. | Implementado + testado |
| V8 | Alta | `helpers/avatarProxy.resolveBlobUrl` e proxies de avatar, consumo e dashboard | SSRF: `path_avatar`/`origem` gravados pelo usuário eram buscados com o token do Blob, para qualquer host. Também permitia ler blobs privados de outro condomínio. | Implementado + testado |
| V9 | Alta | `downloadDocumentoFinanceiro` | Não conferia `condominios/{id}` no caminho, permitindo leitura entre condomínios. A checagem de unidade do morador casava a query string. | Implementado + testado |
| V10 | Alta | `integracaoBancariaController` (listar, saldo, extrato, testar) | Qualquer perfil (morador, portaria) via saldo e extrato bancários do condomínio e os dados da conta. | Implementado + testado |
| V11 | Alta | `GET /receitas/:id/boleto-bancario(/pdf)` | O morador lia boleto de outra unidade (linha digitável, PIX, nome do pagador, `id_externo` usado em V6). | Implementado + testado |
| V12 | Alta | `relatorios/envio-config` (CRUD) | Nenhum perfil exigido, e o convite bastava. Os relatórios do condomínio podiam ser redirecionados para e-mail externo. | Implementado + testado |
| V13 | Alta | `editarDashboardRegistro`, `excluirDashboardRegistro` | `WHERE id = :id` sem filtro de condomínio, e `id_condominio` lido do body. Era possível editar e excluir registros de qualquer condomínio. | Implementado + testado |
| V14 | Alta | CRUD de condomínio; tipos de dashboard; `push/teste(/massa)`; `POST /whatsapp/instancia`; `atualizarFaturaPlanoCondominio`; `uploadAvatarUsuario`; `atualizarTratamentoAgenda` | Nenhum perfil exigido. Listar condomínios expunha todos os tenants. Morador aprovava reservas e trocava o avatar de terceiros. | Implementado + testado |
| V15 | Alta | `_isGestor` (4 controllers), `_podeGerenciarPermissoesMenu`, `_podeVisualizarDadosMorador` | Usavam o **nome** do perfil, que deriva da coluna editável `tipo`. | Implementado (testes indiretos) |
| V16 | Alta | Segredos | `JWT_SECRET` com fallback fixo no código (`dev_jwt_secret_change_me`). `INVITE_TOKEN_SECRET` caía para `JWT_SECRET` e depois para outra string fixa. | Implementado + testado |
| V17 | Alta | Uploads (5 rotas multer) | Sem allowlist de tipo. A extensão vinha do nome enviado e o `content-type` do cliente era devolvido sem `nosniff`, o que permitia XSS armazenado (HTML/SVG). | Implementado + testado |
| V18 | Média | Login | Senha em texto puro aceita como fallback. Sem rate limit (o de memória não funciona em serverless). O timing revelava usuários. JWT de 1 dia sem revogação; logout não revogava. | Implementado + testado |
| V19 | Média | Log de acesso | O IP enviado pelo navegador (`body.ip`, `X-Client-IP`, inclusive via `back-cond.php`) substituía o IP real, ou seja, **o log podia ser forjado**. Um e-mail fixo nunca era registrado. Ninguém auditava alterações de usuário. | Implementado + testado |
| V20 | Média | Diversos | Cerca de 190 respostas com `detail: error.message`. Estáticos `/uploads` e `/tmp` serviam qualquer arquivo (ex.: `swagger-produtos.js`). `base_url` livre no convite (phishing). `criarReceita` aceitava `id_usuario` de outro condomínio. A allowlist do Inter aceitava `../` e `devolucao` (PIX de saída). | Implementado (parte testada) |
| V21 | Média | Dependências | `npm audit`: 82 vulnerabilidades (11 críticas). | Parcial: 36 (3 críticas) |

Também verificado, sem problema encontrado:
- **SQL injection:** nenhuma encontrada; as interpolações usam whitelist ou constantes.
- **Pagamentos:** não há operação de saída de dinheiro (PIX/transferência).
- **Credenciais do Inter:** cifradas com AES-256-GCM e nunca devolvidas pela API.
- **Rotas cruzadas entre condomínios:** as rotas da integração bancária já filtravam por condomínio.

**Sobre o `back-cond.php`:** ele usa o mesmo handler de login. O IP do navegador nunca foi usado para decisões de segurança, só no log (V19). O JWT é devolvido na resposta do login, o que é esperado. O token carrega PII (CPF, telefone): ver riscos residuais.

---

## B. Correções realizadas

### Arquivos novos

| Arquivo | Função |
|---|---|
| `src/helpers/segredos.js` | `JWT_SECRET` e `SERVICE_INVITE_TOKEN_SECRET` obrigatórios. Sem fallback: o processo não sobe sem eles. |
| `src/helpers/sessao.js` | Revogação por `tb-usuarios.token_version` (claim `tv`), com cache de 60s. Usuário inativo perde a sessão. |
| `src/helpers/permissoes.js` | Perfis por **id**, `exigirGestor`/`exigirAdmin` e a hierarquia de quem atribui qual perfil. |
| `src/helpers/auditoria.js` | Grava em `tb_auditoria_seguranca`, sem nunca registrar senha ou token. |
| `src/helpers/blobUrl.js` | Valida a URL do Blob por host e caminho já parseados, e assina links de download. |
| `src/helpers/uploadPolicy.js` | Allowlist por contexto, checagem por magic bytes e extensão derivada do conteúdo. |
| `src/database/migrations/20261123000001-hardening-recovery-sessoes-auditoria.js` | Colunas de reset token, `token_version`, `tb_auditoria_seguranca` e índices. Expurga os JWTs gravados. Compatível com PG 9.2 e com `down()`. |
| `tests/**` | Jest + supertest com banco simulado: 6 suítes, 91 testes. |

### Principais mudanças por área

**Recuperação de senha** (`condominioController`, `routes/recovery.js`)
- Um único fluxo serve o app e o PHP: o código vai por e-mail; o verify emite um reset token opaco (sha256 no banco, uso único, 15 min); o reset consome o token de forma atômica e revoga as sessões.
- OTP gerado com `crypto.randomInt`. Rate limit persistente: 3 desafios por usuário por hora e 10 por IP a cada 15 min. Incremento de tentativas atômico.

**Sessão e login** (`auth.js`, `loginController.js`)
- Tokens de imagem, convite e recuperação são recusados como sessão. Só HS256 é aceito.
- Rate limit de login: 10 falhas por login e 30 por IP a cada 15 min, contadas em `tb_sgw_log_acesso`.
- Bcrypt "dummy" para não revelar usuários pelo tempo de resposta. Senha legada em texto puro é regravada como bcrypt no login.
- O log grava o IP real (`trust proxy`).

**Usuários** (`editarUsuario`, `criarUsuario`)
- Regras: o próprio usuário altera só dados pessoais; gestores editam sem tocar em Admin e sem atribuir perfil acima do seu; `invite_token` não altera nenhum campo sensível.
- Troca da própria senha exige `senha_atual`. **Achado adicional:** o app já enviava `senha_atual`/`nova_senha`/`confirmar_senha`, mas o backend ignorava esses campos, ou seja, a troca de senha do app não funcionava. Agora funciona.
- Mudar senha, perfil, status ou e-mail revoga as sessões do usuário e gera auditoria.

**Multi-tenant**
- Dashboard registro com filtro de condomínio; morador só altera os próprios registros.
- Condomínio: Admin cria e lista todos; os demais só o próprio.
- Avatar: só o próprio usuário ou um gestor, com condomínio do token.
- Agenda: só gestor trata reservas; morador só cancela a própria.
- Receitas: `id_usuario`/`id_unidade` precisam ser do condomínio.

**Financeiro**
- Webhook: o payload é só um aviso. O backend reconsulta o Inter com a credencial da própria cobrança e aplica o status do banco, com deduplicação pelo status real. Segredo opcional `WEBHOOK_BANCARIO_SECRET`, sem gravar headers sensíveis.
- Saldo, extrato e listagem só para gestor, com auditoria.
- Boleto: só da própria unidade.
- Downloads: link assinado (e-mail) ou gestor do condomínio; host exato; caminho do condomínio do token.
- Allowlist do Inter normalizada, com `devolucao` bloqueado.
- Auditoria em: cancelamento de boleto, edição de receita (situação, pagamento, valor), conexão e desativação de integração.

**Superfície de ataque**
- Allowlist de host para o proxy de imagens (anti-SSRF).
- Política de upload em todas as rotas multer.
- Headers de segurança e CSP `default-src 'none'`; `x-powered-by` desativado.
- `detail` removido das respostas 5xx em um ponto único (desligável com `EXPOR_DETALHE_ERRO=true`).
- Estáticos servem só imagens.
- `base_url` do convite restrita a uma allowlist.

**Dependências**
- Removidas 14 sem uso (incluindo `request`, `mysql`, `puppeteer` direto, `pm2`, `crypto-js`).
- Atualizadas: `jsonwebtoken` 9.0.2, `multer` 1.4.5-lts.2, `express` 4.22, `body-parser` 1.20.3 e `nodemailer` 6.9.16, além do `npm audit fix` sem `--force`.
- `yarn.lock` foi regenerado pelo npm. Se ninguém usa yarn, ele pode ser removido.

### Testes executados

`npm test`: **6 suítes, 91 testes, todos passando** (banco simulado; nenhum acesso a banco real, Inter ou e-mail).

| Suíte | Cobertura |
|---|---|
| `recovery.test.js` | Lookup não vaza token; mesma resposta com usuário inexistente; rate limit; reset token opaco (só o hash gravado); uso único; expiração; token de outro usuário; 5 tentativas; o JWT antigo não redefine senha nem autentica `PUT /usuarios`. |
| `auth.test.js` | JWT adulterado, de outro segredo, `alg none` ou expirado; token de imagem e de convite como sessão; `token_version`; usuário inativo; logout revoga; login com mesma mensagem, rate limit 429, IP forjado e migração de senha legada. |
| `usuarios-authz.test.js` | Escalada vertical e horizontal; troca de senha com `senha_atual`; convite não altera campos sensíveis; relatórios exigem gestor. |
| `multitenant.test.js` | Condomínio, dashboard, usuário, avatar e reserva de outro condomínio; rotas de Admin. |
| `financeiro.test.js` | Saldo e extrato por perfil; boleto de outra unidade; webhook forjado; download assinado, host falso e outro condomínio. |
| `uploads-exposicao.test.js` | Upload sem auth; HTML, SVG, EXE e script disfarçados; SSRF; `detail` oculto; headers; estáticos. |

**Não testado em ambiente real:** a migration no PostgreSQL 18 (o banco foi atualizado do 9.2), o envio real de e-mail, a reconsulta real ao Inter e o fluxo completo pelo PHP.

### Impacto no frontend

Detalhes em `docs/seguranca/contrato-recuperacao-senha-php.md`.

**PHP**
- **Recuperação de senha muda e fica fora do ar até o ajuste**: lookup → código por e-mail → `verify-code` → `/api/auth/recovery/reset`.
- Não usar mais `PUT /usuarios/:id` com token.
- Telas que trocam a **própria** senha precisam enviar `senha_atual`.
- Criar, editar e excluir configuração de relatório exige JWT de gestor.
- **Links de boleto em e-mails já enviados deixam de funcionar**, porque agora são assinados.
- Telas que usavam endpoints agora restritos podem receber 403: CRUD de condomínio (Admin), tipos de dashboard, push de teste, instância de WhatsApp e listagem/saldo/extrato da integração bancária.

**App React**
- Compatível sem mudança.
- Depois de trocar a senha, a sessão atual é revogada e o app recebe 401 na chamada seguinte. Confirmar que ele leva ao login.
- Avatares cujo `path_avatar` não seja do Vercel Blob deixam de ser servidos pelo proxy.

---

## C. Pendências

### Antes do deploy (obrigatório)

1. **Vercel:** confirmar que `JWT_SECRET` e `SERVICE_INVITE_TOKEN_SECRET` estão definidos, e com valores **diferentes**. Sem eles a API não sobe.
   - O `.env` local não tem `JWT_SECRET`, então o `npm start` local vai falhar até ele ser adicionado.
   - O README (commit `5e0ecc3`) tem um valor de exemplo ("troque..."). Confirmar que produção não usa esse valor.
2. **Backup e migration:**
   - fazer `pg_dump` de `"condominio-bh".tb_recovery_tokens` e `"condominio-bh"."tb-usuarios"`;
   - rodar a migration `20261123000001` **antes** de publicar o código, porque a recuperação de senha depende das colunas novas;
   - se a migration ainda não tiver rodado, o auth funciona sem `token_version` (aviso no log), mas sem revogação.
3. **Ajustar o PHP** conforme o contrato, junto com o deploy.

### Credenciais a rotacionar (por precaução, dado o incidente)

| Credencial | Motivo |
|---|---|
| `JWT_SECRET` | Derruba todas as sessões atuais, inclusive as obtidas no incidente. Invalida também os links assinados de boleto. |
| `SERVICE_INVITE_TOKEN_SECRET` | Tokens de recuperação foram expostos. Invalida convites pendentes. |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_PRIVATE_READ_WRITE_TOKEN` | V7 e V8 permitiam enviá-los a terceiros. |
| `CRON_QUEUE_KEY` e `PUBLIC_REGISTRATION_KEY` | Esta última junto com o PHP. |
| `INTEGRATION_ENCRYPTION_KEY` e credenciais do Inter | Só se houver indício de acesso ao banco ou ao ambiente da Vercel. Exige recifrar as credenciais. |

**Contas:** forçar a troca de senha das contas alteradas na janela do incidente (consultas 3, 3d e 3e) e revisar todos os usuários com perfil 1.

### Configurações novas (opcionais)

| Variável | Efeito |
|---|---|
| `WEBHOOK_BANCARIO_SECRET` | Exige recadastrar a webhookUrl no Inter (`PUT /cobranca/v3/cobrancas/webhook`) como `.../api/webhook/bancario/inter?k=<segredo>`. |
| `ALLOWED_INVITE_BASE_URLS` | Origens aceitas no `base_url` do convite. |
| `CORS_ORIGINS` | Hoje nenhuma origem recebe CORS, o mesmo comportamento de antes. |

### Vulnerabilidades ainda abertas

| Item | Risco | Motivo / próximo passo |
|---|---|---|
| Escrita em regulamento, espaço, consumo e reunião sem checagem de perfil | Médio (dentro do próprio condomínio) | Precisa cruzar com `tb_sgw_perfil_menu` para não bloquear Portaria e Colaborador em telas legítimas. |
| `listarUsuariosPorCondominio` / `buscarUsuarioPorId` devolvem CPF, telefone e e-mail de vizinhos a qualquer morador | Médio (LGPD) | Confirmar quais campos o app e o PHP consomem antes de omitir. |
| `recoveryRequest` ainda devolve `user_id` (revela que o e-mail existe) | Baixo/Médio | Mantido para não quebrar o app publicado. Remover depois que o app passar a enviar `login`. |
| Token de imagem de avatar não confere o id do recurso | Baixo | Um token de imagem serve para ler outro avatar do mesmo condomínio por 5 min. |
| `mysql2` (crítica) | Baixo | Usado só por `src/database/config.js` (config MySQL legada do sequelize-cli); a API usa `pg`. |
| `pdfkit` (crítica) e `html-pdf-node` | Baixo | Só em `pdfController.js`, que não está montado. Remover ou atualizar para major nova. |
| `multer` 1.x | Médio | 2.x corrige DoS; exige teste dos uploads. |
| `axios` 0.21 | Baixo | Só em `task/acoes_tela.js` (legado). |
| Código morto (`routes/uploads.js`, `routes/usersystem.js`, `pdfController.js`) | Baixo | Não montado. Remover. |
| Token aceito via `?token=` e no body | Baixo/Médio | Vaza em logs e histórico. Mantido por compatibilidade com o PHP. |
| JWT de login carrega PII (CPF, telefone) e vale 1 dia | Baixo | Reduzir o payload e o TTL quando o front tiver refresh. |
| `INVITE_TOKEN_MAX_USES` e rate limit de cadastro por convite em memória | Baixo | Ineficazes em serverless. Mover para o banco. |

### Correção de dados (não executada; precisa de autorização)

- Reverter receitas e boletos marcados como pagos ou cancelados por webhook forjado (consulta 4c, conferida no Internet Banking).
- Reverter perfis e e-mails alterados indevidamente (consultas 3, 3c, 3d).
- Remover configurações de relatório com destinatários externos (consulta 6).

---

## D. Segurança pós-correção

### Monitoramento e alertas sugeridos

Todos a partir de `tb_auditoria_seguranca` e `tb_sgw_log_acesso`. Sugestão: uma consulta agendada que envia e-mail ao Admin.

- `senha_redefinida_recuperacao` e `usuario_editado` com `tipo_perfil_id_novo = 1`: alerta imediato.
- Mais de 20 falhas de login por IP por hora, e respostas 429 de login ou recuperação.
- `cobranca_situacao_webhook`: comparar diariamente com o extrato. Os avisos `[webhook-bancario] Payload divergente` no log da Vercel indicam tentativa de forjar.
- `integracao_conectada`, `integracao_desativada` e `integracao_taxa_acima_limite`.
- Leituras de saldo e extrato fora do horário comercial.
- Novos usuários com perfil 1, 3 ou 4, e novas configurações de relatório com domínio externo.

**Logs:**
- Habilitar Log Drain da Vercel para um destino com retenção maior que a padrão. Hoje não há log de requisições.
- Registrar método, rota, status, IP (`req.ip`) e id do usuário, nunca o corpo nem tokens.

### Prevenção

- Toda rota nova deve declarar `auth` e um guard de `helpers/permissoes.js`. O `id_condominio` vem sempre do token (exceto Admin).
- Toda URL buscada pelo servidor passa por `helpers/blobUrl.parseUrlBlob`.
- Todo upload passa por `validarUploads`.
- Rodar `npm test` e `npm audit --omit=dev` no CI. Os testes deste relatório servem de regressão de segurança.
- ~~Atualizar o PostgreSQL 9.2~~: feito, produção está no 18.7. No `pg_hba.conf`, usar `hostssl` + `scram-sha-256` (`md5` está obsoleto no 18). Usar um usuário de banco da aplicação **sem** privilégios de DDL/superuser, e um usuário separado para as migrations.

### Riscos residuais

- O Inter não assina o webhook. A defesa é a reconsulta ao banco: um atacante só consegue provocar consultas, não alterar status. Os limites de taxa da API do Inter podem ser consumidos por flood; mitigação parcial: cobranças já pagas ou canceladas não são reconsultadas.
- A revogação de sessão depende do banco: um SELECT por requisição, com cache de 60s. Uma sessão revogada pode valer por até 60s na mesma instância serverless.
- O fluxo de recuperação continua com código de 6 dígitos por e-mail. A segurança depende da conta de e-mail do morador.
- Este repositório não cobre o frontend PHP. Qualquer endpoint PHP que repasse chamadas ao backend com credenciais próprias precisa da mesma revisão.
