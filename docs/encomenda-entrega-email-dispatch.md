# Disparo de e-mail ao confirmar entrega de encomenda (e-Morador)

Este documento descreve o fluxo de e-mail transacional acionado quando a portaria marca uma Encomenda como retirada, via `src/service/encomendaEntregaEmailService.js`.

## O front não participa do disparo

O front só faz o `PUT` de atualização do registro; todo o disparo é feito pelo backend Node, servidor-a-servidor, contra um serviço externo de e-mail dedicado (repositório separado, fora deste projeto).

```
Front (PUT /dashboard/registros/:id, tipo: 3, status: "entregue")
        │
        ▼
Backend Node — editarDashboardRegistro()  (src/controllers/condominioController.js)
        │  detecta transição para status=entregue → resolve moradores da unidade
        ▼
encomendaEntregaEmailService.despacharEncomendaEntregaEmail()  →  POST ENCOMENDA_ENTREGA_EMAIL_URL
        │       Authorization: Bearer <PUBLIC_EMAIL_DISPATCH_KEY>
        │       X-Public-Email-Key: <PUBLIC_EMAIL_DISPATCH_KEY>
        ▼
Serviço externo (encomenda-entrega-email.php) monta o texto e envia o e-mail
```

Esse endpoint é **distinto** do `public-email-dispatch.php` usado pelo `emailDispatchService.js` (templates `encomenda_notificacao`, `dashboard_registro_notificacao`, etc.) — é um arquivo PHP dedicado só para o e-mail de entrega, sem conceito de `template` no payload.

## Endpoint que aciona o envio

- `PUT /api/condominio/dashboard/registros/:id`
- Body relevante:

```json
{
  "tipo": 3,
  "status": "entregue"
}
```

O disparo só ocorre quando, após o `UPDATE`:
- `tipo` final `=== 3` (Encomenda), **e**
- `status` final `=== 'entregue'`, **e**
- `status` do registro **antes** desse PUT era diferente de `'entregue'` — guarda de idempotência: reenviar o mesmo PUT num registro já entregue não reenvia o e-mail.

O disparo roda via `waitUntil()` (`@vercel/functions`), depois da resposta HTTP já ter sido enviada — não bloqueia nem depende do front esperar.

## Regra de destinatários

Somente moradores **ativos** (`tb-usuarios.status`) da mesma unidade (`apartamento` + `bloco`) e condomínio do registro, com e-mail preenchido — mesma consulta usada para resolver os destinatários do push e do log de notificação (`tb_notificacao_log`, tipo 8 "Entrega Encomenda") desse mesmo evento.

## Payload enviado (uma chamada em lote, todos os destinatários da unidade)

```json
{
  "emails": ["morador1@example.com", "morador2@example.com"],
  "encomenda": {
    "apartamento": "101",
    "bloco": "1",
    "condominio_nome": "Edifício e-Morador Dev",
    "empresa_entrega": "Correios",
    "id_registro": "57"
  }
}
```

- `empresa_entrega`: já resolvido para o nome da empresa (não o id) — se o registro guarda um id numérico em `empresa_entrega`, o backend busca o nome em `tb_dashboard_empresas` antes de montar o payload.
- `id_registro`: id do registro do dashboard (`tb_dashboard_registro.id`), como string.
- Sem `template` — o serviço externo (`encomenda-entrega-email.php`) só monta o texto e envia; não faz nenhuma resolução de destinatário.

## Retentativas e falhas

- Erro 5xx do serviço externo → até 3 tentativas (`MAX_RETRIES` em `encomendaEntregaEmailService.js`).
- Erro 4xx → **não** tenta de novo, loga e segue.
- Sucesso é definido apenas pelo HTTP status (`resp.ok`) — o contrato de resposta do endpoint ainda não define um campo `success` dedicado; se isso mudar, ajustar `despacharEncomendaEntregaEmail` para checar também o corpo da resposta, no mesmo padrão de `emailDispatchService.js`.
- Falha na resolução de destinatários ou no disparo não interrompe a atualização do registro (que já respondeu 200 antes desse bloco rodar).
- Logs relevantes: `[encomendaEntregaEmail] ...` (sucesso/falha por chamada) e `[emailDispatch] Erro encomenda entregue: ...` (falha ao montar/chamar o disparo).

## Pendências

- Contrato final do payload ainda precisa ser confirmado entre os times Node e PHP antes de produção.
- O arquivo `service/encomenda-entrega-email.php` precisa ser publicado manualmente no servidor de produção (fora deste repositório) — sem isso, mesmo com o Node chamando corretamente, o endpoint não existe no ar.

## Não existe callback pro front

Não há webhook nem segunda chamada informando se o e-mail foi entregue. A única forma de confirmar o disparo é olhando os logs do servidor.
