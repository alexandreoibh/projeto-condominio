# Regras de Push Notification (e-Morador)

Este documento consolida o fluxo de push notification entre app, backend e Expo Push API.

## Fluxo de registro do token no app

1. Usuário faz login.
2. `AuthContext.signIn()` salva o token JWT.
3. `HomeScreen` monta.
4. `usePushNotifications()` executa.
5. O app pede permissão ao usuário (na primeira vez).
6. O Expo gera o push token do dispositivo.
7. O app chama `POST /api/usuario/push-token`.
8. O backend salva o token vinculado ao usuário autenticado no JWT.

Endpoint de registro de token:

- URL: `POST /api/usuario/push-token`
- Auth: `Authorization: Bearer <jwt>`
- Body:

```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "plataforma": "android"
}
```

Resposta de sucesso:

```json
{ "success": true }
```

## Fluxo de envio quando ocorre evento no backend

Exemplo: porteiro cadastra encomenda para o apartamento 101.

1. O backend identifica o(s) usuário(s) destino da notificação.
2. O backend busca os `push_token` ativos em `tb_usuario_push_tokens`.
3. O backend envia para a Expo Push API.
4. A Expo entrega no dispositivo do usuário.
5. O usuário toca na notificação.
6. O app abre e `onNotificationTap()` recebe `data.tipo = "encomenda"`.

Payload padrão enviado para Expo:

```json
{
  "to": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "title": "📦 Nova encomenda!",
  "body": "Seu pacote chegou na portaria.",
  "sound": "default",
  "data": {
    "tipo": "encomenda",
    "id": 42,
    "rota": "/encomendas"
  }
}
```

Endpoint Expo utilizado pelo backend:

- `POST https://exp.host/--/api/v2/push/send`

## Tipos de evento suportados no app

- `encomenda` - Chegada de encomenda na portaria
- `reuniao` - Convocação de reunião de condomínio
- `aviso` - Aviso geral do síndico
- `ocorrencia` - Atualização de ocorrência
- `financeiro` - Boleto gerado / vencimento
- `visitante` - Visitante aguardando na portaria

## Envio em massa

A API da Expo aceita até 100 tokens por requisição.

Exemplo de envio em massa por mensagens:

```json
[
  {
    "to": "ExponentPushToken[token1]",
    "title": "Reunião amanhã",
    "body": "...",
    "data": { "tipo": "reuniao" }
  },
  {
    "to": "ExponentPushToken[token2]",
    "title": "Reunião amanhã",
    "body": "...",
    "data": { "tipo": "reuniao" }
  }
]
```

No backend, o envio é particionado em lotes de até 100 mensagens por chamada para manter compatibilidade com a Expo.

## Endpoints de teste manual (backend)

- `POST /api/usuario/push/teste`
- `POST /api/usuario/push/teste/massa`

Ambos exigem `Authorization: Bearer <jwt>`.
