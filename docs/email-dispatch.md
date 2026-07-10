# Disparo de e-mail no módulo financeiro (e-Morador)

Este documento consolida o fluxo de envio de e-mail transacional usado hoje pela publicação de balancete (Prestação de Contas), via `src/service/emailDispatchService.js`.

## O front não participa do disparo

O front **não chama nenhum serviço de e-mail diretamente**. Ele só manda um campo no body do endpoint de publicação; todo o disparo é feito pelo backend Node, servidor-a-servidor, contra um serviço externo de e-mail (repositório separado, fora deste projeto).

```
Front (POST /balancete/publicar, enviar_email: 1)
        │
        ▼
Backend Node — publicarBalancete()  (src/controllers/financeiroController.js)
        │  monta 1 chamada por destinatário elegível
        ▼
emailDispatchService.despacharEmail()  →  POST EMAIL_DISPATCH_URL (serviço externo, PHP)
        │       Authorization: Bearer <PUBLIC_EMAIL_DISPATCH_KEY>
        ▼
Serviço externo resolve o template e envia o e-mail de verdade
```

## Endpoint que aciona o envio

- `POST /api/condominio/financeiro/balancete/publicar`
- Body:

```json
{
  "competencia": "2026-07-01",
  "enviar_email": 1
}
```

- `enviar_email: 1` → publica o balancete **e** dispara e-mail para os destinatários elegíveis.
- `enviar_email: 0` ou ausente → só publica (push + log de notificação, sem e-mail).

O disparo roda em `setImmediate()`, depois da resposta HTTP já ter sido enviada — não bloqueia nem depende do front esperar.

## Regra de destinatários

Todos os usuários **ativos** do condomínio (`tb-usuarios.status`), **de qualquer perfil, exceto Portaria** (perfil resolvido via `tb_sgw_perfil` — mesma junção usada no login para resolver `nomePerfil`), com e-mail preenchido. Mesma regra usada para o log de notificação (`tb_notificacao_log`) dessa mesma publicação.

## Template usado

- `balancete_publicado` — cadastrado no serviço externo de e-mail (`service/public-email-dispatch.php`, repositório à parte). Antes de existir lá, a chamada falhava com 422 "Template de e-mail não suportado".

## Payload enviado (uma chamada por destinatário)

```json
{
  "_ref": "balancete_277_2026-07_10",
  "template": "balancete_publicado",
  "email": "morador@example.com",
  "nome": "Alexandre",
  "periodo": "2026-07",
  "competencia": "Julho/2026",
  "mensagem": "Houve publicação da Prestação Contas JUL/2026, acompanhe no dashboard",
  "condominio_nome": "Edificio e-Morador Dev"
}
```

- `periodo`: formato `YYYY-MM`, para uso interno/depuração.
- `competencia`: rótulo formatado `Mês/Ano` (ex.: `Julho/2026`) — é o campo que o serviço externo usa para montar o "Competência" nos detalhes do e-mail.
- `condominio_nome`: nome do condomínio, para o "Condomínio" nos detalhes do e-mail.

## Retentativas e falhas

- Erro 5xx do serviço externo → até 3 tentativas (`MAX_RETRIES` em `emailDispatchService.js`).
- Erro 4xx (ex.: template não cadastrado, payload inválido) → **não** tenta de novo, loga e segue.
- Falha de um destinatário não interrompe os demais (loop com `try/catch` por e-mail) nem afeta a publicação do balancete (que já respondeu 200 antes desse bloco rodar).
- Logs relevantes: `[emailDispatch] ...` (sucesso/falha por chamada) e `[publicarBalancete] Erro ao enviar e-mail para usuário ...` (falha ao montar/chamar por destinatário específico).

## Não existe callback pro front

Não há webhook nem segunda chamada informando se o e-mail foi entregue. A única forma de confirmar o disparo é olhando os logs do servidor.
