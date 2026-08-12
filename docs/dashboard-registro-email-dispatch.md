# Disparo de e-mail no cadastro de Registro do Dashboard (e-Morador)

Este documento descreve o fluxo de e-mail transacional acionado pelo switch "Notificar ... por E-mail" da tela "Novo Registro do Dashboard" (Ocorrências, Avisos, Encomendas etc.), via `src/service/emailDispatchService.js`.

## O front não participa do disparo

O front só manda um campo no body do endpoint de criação; todo o disparo é feito pelo backend Node, servidor-a-servidor, contra um serviço externo de e-mail (repositório separado, fora deste projeto).

```
Front (POST /dashboard/registros, enviar_email: 1)
        │
        ▼
Backend Node — criarDashboardRegistro()  (src/controllers/condominioController.js)
        │  resolve perfil de quem criou → resolve destinatários → 1 chamada em lote
        ▼
emailDispatchService.despacharEmail()  →  POST EMAIL_DISPATCH_URL (serviço externo, PHP)
        │       Authorization: Bearer <PUBLIC_EMAIL_DISPATCH_KEY>
        │       X-Public-Email-Key: <PUBLIC_EMAIL_DISPATCH_KEY>
        ▼
Serviço externo resolve o template e envia o e-mail de verdade
```

## Endpoint que aciona o envio

- `POST /api/condominio/dashboard/registros`
- Body (multipart ou JSON):

```json
{
  "tipo": 1,
  "titulo": "Vazamento na garagem",
  "descricao": "Vazamento identificado próximo à vaga 12.",
  "enviar_email": 1,
  "unidade_bloco": "1",
  "unidade_apartamento": "403",
  "unidade_label_bloco": "Torre"
}
```

- `enviar_email: 1` (ou `"1"`) → cria o registro **e** dispara e-mail para os destinatários elegíveis.
- `enviar_email` ausente ou `0` → só cria o registro, sem e-mail (comportamento atual, sem mudança).
- `unidade_bloco`, `unidade_apartamento`, `unidade_label_bloco` — opcionais, texto livre (máx. 50 caracteres cada). Só fazem sentido quando quem cria o registro é Morador (perfil 2) — para os demais perfis o backend os omite do payload de e-mail mesmo que o front os envie (ver "Regra de destinatários" abaixo). `unidade_label_bloco` é o rótulo que o condomínio usa para "bloco" (ex.: "Torre", "Bloco", "Prédio").

O disparo roda via `waitUntil()` (`@vercel/functions`), depois de `transaction.commit()` — não bloqueia nem depende do front esperar.

Este e-mail é **independente** do e-mail de encomenda já existente (`tipoRegistro === 3`, template `encomenda_notificacao`, disparado sempre que há `apartamento` informado, sem depender de `enviar_email`). Um registro de Encomenda criado com `enviar_email: 1` dispara os dois e-mails: o de encomenda (moradores do apartamento) e este genérico (destinatários por perfil).

## Regra de destinatários

Espelha a regra já usada no canal Telegram desta mesma tela (`_enfileirarMensagem` / `tb_mensagens_fila`), resolvida a partir do `tipo_perfil_id` de quem criou o registro:

| Quem criou o registro | `tipo_perfil_id` | Quem recebe o e-mail |
|---|---|---|
| Morador | 2 | Síndico(s) + Sub-Síndico(s) (perfis 3 e 4) |
| Síndico | 3 | Moradores (perfil 2) |
| Sub-Síndico | 4 | Moradores (perfil 2) |
| Admin | 1 | Moradores (perfil 2) |
| Portaria | 5 | Moradores (perfil 2) |
| Colaborador | 54 | Moradores (perfil 2) |

Resumo: se quem criou é Morador, o e-mail vai para a gestão (perfis 3/4); em qualquer outro caso, vai para os moradores (perfil 2). Portaria e Colaborador nunca recebem — só disparam a notificação, como os demais perfis de gestão.

Só entram usuários **ativos** do condomínio do registro (`tb-usuarios.status`), com e-mail preenchido.

## Template usado

- `dashboard_registro_notificacao` — precisa estar cadastrado no serviço externo de e-mail (`service/public-email-dispatch.php`, repositório à parte). Antes de existir lá, a chamada falha com 422 "Template de e-mail não suportado" (logado, não bloqueia a criação do registro).

## Payload enviado (uma chamada em lote, todos os destinatários)

```json
{
  "_ref": "dashboard_registro_482",
  "template": "dashboard_registro_notificacao",
  "emails": ["sindico@example.com", "subsindico@example.com"],
  "registro": {
    "titulo": "Vazamento na garagem",
    "tipo": "Ocorrências do dia",
    "descricao": "Vazamento identificado próximo à vaga 12.",
    "condominio_nome": "Edifício e-Morador Dev",
    "unidade_bloco": "1",
    "unidade_apartamento": "403",
    "unidade_label_bloco": "Torre"
  }
}
```

- `registro.tipo`: rótulo legível do tipo de registro, resolvido via `tb_dashboard_tipo.descricao` (não o id numérico bruto).
- `registro.condominio_nome`: nome do condomínio, para o "Condomínio" nos detalhes do e-mail.
- `registro.unidade_bloco` / `registro.unidade_apartamento` / `registro.unidade_label_bloco`: só aparecem no payload quando quem criou o registro é Morador (`tipo_perfil_id = 2`) — repassados exatamente como vieram no body da criação (`req.body.unidade_bloco` etc., via `_normalizarTextoOuNull`). Para os demais perfis (Síndico, Sub-Síndico, Admin, Portaria, Colaborador), essas 3 chaves **não são incluídas** no JSON, mesmo que o front as envie por engano — o serviço externo usa esses campos para enriquecer assunto e corpo do e-mail com a unidade de origem da ocorrência.

## Retentativas e falhas

- Erro 5xx do serviço externo → até 3 tentativas (`MAX_RETRIES` em `emailDispatchService.js`).
- Erro 4xx (ex.: template não cadastrado, payload inválido) → **não** tenta de novo, loga e segue.
- Falha na resolução de destinatários ou no disparo não interrompe a criação do registro (que já respondeu 201 antes desse bloco rodar).
- Logs relevantes: `[emailDispatch] ...` (sucesso/falha por chamada) e `[emailDispatch] Erro registro dashboard: ...` (falha ao montar/chamar o disparo).

## Não existe callback pro front

Não há webhook nem segunda chamada informando se o e-mail foi entregue. A única forma de confirmar o disparo é olhando os logs do servidor.
