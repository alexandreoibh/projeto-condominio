# Contrato novo: recuperação de senha (frontend PHP e app)

**Vale a partir do deploy da branch `security/hardening-2026-11-23`.** Até o PHP ser ajustado, a recuperação de senha pelo site fica indisponível. Isso é intencional: o fluxo antigo permitia tomada de conta sem login.

## O que mudou

| Antes | Agora |
|---|---|
| `POST /api/condominio/auth-recovery-lookup` devolvia `invite_token` (JWT de 24h) sem pedir código | Só envia um código de 6 dígitos ao e-mail cadastrado. A resposta é sempre a mesma e não traz token, id nem nome |
| `auth-recovery-verify-code` devolvia o mesmo JWT de 24h | Devolve um **reset token opaco**, de **uso único** e **válido por 15 min** |
| `PUT /api/condominio/usuarios/:id` com `invite_token` trocava senha, e-mail e até o perfil | **Não aceita mais** senha, e-mail, CPF, perfil ou status via `invite_token`. A troca de senha por recuperação é só por `/api/auth/recovery/reset` |
| `/api/auth/recovery/reset` aceitava o JWT de 24h várias vezes | Aceita só o reset token, uma vez. Depois do reset, **todas as sessões do usuário são encerradas** |

## Fluxo para o PHP

### 1. Pedir o código

```
POST /api/condominio/auth-recovery-lookup
Content-Type: application/json

{ "login": "<e-mail ou CPF>" }
```

A resposta é sempre `200`:

```json
{ "success": true, "message": "Se os dados estiverem cadastrados, você receberá um código por e-mail." }
```

- O código é enviado pelo backend (template `auth_recovery_token`). **O PHP não deve mais gerar nem enviar códigos próprios.**
- A tela não deve dizer se o usuário existe.
- Limites: 3 códigos por usuário por hora e 10 por IP a cada 15 min. Acima disso a resposta é a mesma, mas nenhum e-mail sai.

### 2. Validar o código

```
POST /api/condominio/auth-recovery-verify-code
{ "email": "<e-mail>", "code": "123456" }
```

- **200:**
  ```json
  { "success": true, "reset_token": "<opaco>", "invite_token": "<o mesmo valor>", "token": "<o mesmo valor>", "token_type": "reset_token", "expires_in": "15m", "user_id": 123 }
  ```
- **422:** código inválido ou expirado.
- **429:** 5 tentativas erradas. É preciso pedir um novo código.

Guarde o `reset_token` só na sessão do servidor PHP, nunca em cookie ou HTML. Não registre em log.

### 3. Definir a nova senha

```
POST /api/auth/recovery/reset
{ "user_id": 123, "reset_token": "<opaco>", "password": "<nova senha, mín. 6>" }
```

O `login` (e-mail ou CPF) é aceito no lugar de `user_id`, e `invite_token` no lugar de `reset_token`.

- **200:** senha trocada. Todas as sessões (JWT) do usuário deixam de valer.
- **401** (`INVALID_TOKEN`): token inválido, expirado ou já usado.

## App React (`29_ProjetoAppCondominio`)

- Compatível sem mudança: `request` continua devolvendo `user_id`, e o `verify` devolve o token em `invite_token`.
- Recomendado na próxima versão: enviar `login` em vez de `user_id` no verify e no reset. Depois disso o backend deixa de devolver `user_id` no `request`, o que hoje ainda revela que o e-mail existe.

## Outras mudanças que o PHP precisa conhecer

- **`back-cond.php` (login):** o IP enviado pelo navegador (`ip`, `X-Client-IP`) **não** é mais gravado como IP do acesso; vai só como `ip_informado` na mensagem do log. Login tem limite: 10 falhas por login ou 30 por IP em 15 min → `429`.
- **Troca da própria senha** (`PUT`/`PATCH /usuarios/:id` com o JWT do próprio usuário): exige `senha_atual`. Envie `senha_atual`, `nova_senha` e `confirmar_senha` (`password` também é aceito no lugar de `nova_senha`). Síndico e admin redefinem a senha de **outro** usuário sem `senha_atual`.
- **Perfis:** apenas os perfis 1, 3 e 4 criam usuários e mudam perfil, status ou unidade. Síndico não atribui Admin; sub-síndico não atribui Admin nem Síndico. Ninguém além do Admin edita um Admin.
- **Relatórios automáticos:** criar, editar e excluir `relatorios/envio-config` exige JWT de Admin, Síndico ou Sub-Síndico. Com `invite_token` só é possível listar as configurações e gravar logs.
- **Link de boleto no e-mail:** passa a ser assinado (`&exp=...&sig=...`, validade de 45 dias). **Links de e-mails já enviados deixam de funcionar.** Gestores autenticados continuam baixando com o JWT.
- **Toda sessão é revogada** quando a senha, o perfil, o status ou o e-mail do usuário mudam, e no logout. O PHP deve tratar `401` mandando para o login.
