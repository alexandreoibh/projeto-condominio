# Contrato: recuperação de senha (frontend PHP e app)

**Versão de 25/11/2026** (branch `security/recovery-2026-11-25`). O backend Node e o PostgreSQL passam a ser a **única autoridade** de rate limit e segurança do fluxo. O rate limit local do PHP (`auth-recovery-store.json`) só deve ser removido **depois** que este backend estiver publicado e validado.

## Cabeçalhos do proxy PHP (obrigatórios quando o PHP chama o backend)

| Header | Valor |
|---|---|
| `X-Proxy-Key` | Valor de `PROXY_SHARED_SECRET`. É o mesmo segredo nos dois lados e nunca vai para o navegador. |
| `X-Client-IP` | `$_SERVER['REMOTE_ADDR']` real do morador (IPv4 ou IPv6 válido). **Não** use `X-Forwarded-For` vindo do navegador. |

- O IP de origem do servidor PHP precisa estar em `TRUSTED_PROXY_IPS` na Vercel.
- **Requisição vinda desse IP sem `X-Proxy-Key` válida:** `401 { code: "proxy_nao_autenticado" }`.
- **`X-Client-IP` ausente ou inválido:** `400 { code: "CLIENT_IP_INVALIDO" }`.
- **`PROXY_SHARED_SECRET` não configurado:** `503`.
- **Chamadas diretas (app ou qualquer outro cliente):** `X-Client-IP`, `X-IP` e `body.ip` são **ignorados**, e vale o IP real observado pela Vercel.
- **Login e demais rotas:** não mudaram nesta etapa e continuam aceitando o proxy como antes.

## Endpoints

### 1. Pedir o código
- **PHP:** `POST /api/condominio/auth-recovery-lookup` (também `.php` e `/service/...`), body `{ "login": "<e-mail ou CPF>" }`.
  - Resposta **sempre** `200 { "success": true, "message": "..." }`, exista ou não a conta.
- **App:** `POST /api/auth/recovery/request`, body `{ "login": "<e-mail ou CPF>" }`.
  - Resposta **sempre** `200 { success, message, user_id: "rh1.<opaco>", expires_at }`.
  - `user_id` é um identificador **opaco** (cifrado, válido por 15 min, sem dado pessoal) e muda a cada chamada. O app só precisa repassá-lo no verify e no reset.
- **Envio:** o código vai **só** para o e-mail cadastrado no banco. Qualquer `email`/`destino` no body é ignorado.
- **Erros:**
  - `400`: `login` ausente.
  - `429 MAX_ATTEMPTS`: limite por IP ou global.
  - `503 SERVICE_UNAVAILABLE`: rate limit ou segredo indisponível.
- Os limites por login e por conta **não** geram 429. A resposta continua genérica e o código simplesmente não é reenviado.

### 2. Validar o código
- **PHP:** `POST /api/condominio/auth-recovery-verify-code`, body `{ "email", "code": "123456" }`.
  - Sucesso: `200` com `reset_token` (também em `invite_token`/`token`), `token_type: "reset_token"`, `expires_in: "15m"` e `user_id` **numérico**.
  - Código inválido: `422 INVALID_CODE`.
- **App:** `POST /api/auth/recovery/verify`, body `{ "user_id": "<rh1 recebido>" | <id numérico legado>, "code" }` ou `{ "login", "code" }`.
  - Sucesso: `200`, mesmos campos, e o `user_id` devolvido é o mesmo recebido.
  - Código inválido: `401 INVALID_CODE`.
- **Mensagem única:** código errado, expirado, já usado, desafio inexistente, conta inexistente e 5 tentativas esgotadas têm **a mesma resposta**.
- **Outros erros:** `429 MAX_ATTEMPTS` (falhas por IP, login ou conta) e `503`.

### 3. Definir a nova senha
- `POST /api/auth/recovery/reset`, body `{ "user_id": <o mesmo usado no verify>, "reset_token", "password" }`.
- **Política de senha (definitiva), validada só no reset; o login com senhas existentes não muda:**
  - mínimo de **15 caracteres** (contados como caracteres Unicode, não bytes): `422 WEAK_PASSWORD`, `min_length: 15`;
  - máximo de **64 caracteres** **e** de **72 bytes UTF-8**, os dois ao mesmo tempo: `422 PASSWORD_TOO_LONG`, `max_length: 64`, `max_bytes: 72`;
    - o limite de bytes existe porque o bcrypt ignora o que passa de 72 bytes. Com acentos ou emoji, 64 caracteres podem passar disso. Exemplo: 40 × "ç" = 80 bytes, recusado;
    - o frontend deve validar as duas regras (em PHP, `mb_strlen($s, 'UTF-8')` e `strlen($s)`; em JS, `[...s].length` e `new TextEncoder().encode(s).length`);
  - sem regra de composição;
  - senha só de espaços é recusada.
- **Respostas:**
  - Sucesso: `200`. A senha, o consumo do token e o encerramento de **todas** as sessões acontecem na mesma transação.
  - Token inválido, expirado, de outra conta ou reutilizado: `401 INVALID_TOKEN`.
  - Limite: `429`. Indisponibilidade: `503`.

## Limites (persistentes no PostgreSQL, atômicos entre instâncias)

| Etapa | Por IP | Por login (HMAC) | Por conta | Global |
|---|---|---|---|---|
| Pedido do código | 10/h | 3/h | 3/h (e-mail + CPF somam) | 500/h |
| Intervalo entre envios | — | 60 s | 60 s | — |
| Validação | 30 falhas/h | 10 falhas/h | 10 falhas/h + 5 por desafio | 1.000/h |
| Reset | 20/h | — | — | 500/h |

## O que o frontend precisa ajustar

1. **PHP:**
   - enviar `X-Proxy-Key` e `X-Client-IP` nas três chamadas;
   - tratar os status `401`, `400`, `429` e `503`;
   - mínimo de senha **15** no formulário.
2. **App** (`EsqueceuSenhaModal.tsx:202` e `:380`): mínimo **15** (hoje é 6). Até a atualização, o backend responde `422 WEAK_PASSWORD` e o app precisa exibir a mensagem.
3. **Remover o `auth-recovery-store.json`** do PHP só depois da validação do backend em produção.

## Publicação e rollback coordenados (a recuperação nunca fica sem proteção)

**Publicação:**
1. Rodar `20261125000001-tb-rate-limit.sql` no Neon e conferir o GRANT.
2. Configurar `RECOVERY_CODE_SECRET` e `PROXY_SHARED_SECRET` na Vercel e `PROXY_SHARED_SECRET` no PHP.
3. **PHP primeiro:**
   - passa a enviar `X-Proxy-Key` e `X-Client-IP`;
   - o limitador local (JSON) **continua ligado**;
   - o backend atual ignora os headers novos, então isso é inofensivo.
4. Deploy do backend.
5. Validar a recuperação completa pelo PHP e pelo app, e testar os casos de 401, 429 e 503 descritos acima.
6. **Desligar** o limitador local do PHP **por flag** (ex.: `RECOVERY_RATE_LIMIT_LOCAL=0`), **sem apagar o código**.
7. Depois de **7 dias** estável, remover o código e o arquivo JSON.

**Rollback do backend** (problema com o deploy novo):
1. **Antes**, religar o limitador local do PHP (`RECOVERY_RATE_LIMIT_LOCAL=1`).
2. Voltar a Vercel para o deployment `b0a9d6c` (Instant Rollback). Ele também limita de forma persistente (contagem em `tb_recovery_tokens` e na auditoria), só que com limites mais fracos.
3. Manter a tabela `tb_rate_limit` e as variáveis novas. Elas não atrapalham e servem para voltar ao deploy novo.
4. Os headers `X-Proxy-Key` e `X-Client-IP` continuam sendo enviados pelo PHP. Para o `b0a9d6c`, `X-Client-IP` vindo de `TRUSTED_PROXY_IPS` continua valendo, como antes.

**Nunca:** remover o limitador do PHP e voltar o backend para uma versão anterior à v2.58 (sem hardening), porque a recuperação ficaria sem limite nenhum.
