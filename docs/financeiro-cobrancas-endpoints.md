# Endpoints de cobrança de inadimplência

Controller: `src/controllers/financeiroController.js`. Rotas: `src/routes/financeiro.js`, montadas em `/api/condominio/financeiro`.

## `GET /inadimplencia`

Lista receitas em aberto vencidas (inadimplência), com paginação (`page`, `pageSize`) e modo resumo (`resumo=1`). Requer `auth`.

## `POST /inadimplencia/{id}/cobrar`

Dispara cobrança (push + e-mail) para os moradores da unidade da receita `{id}`. Requer `auth` + perfil gestor (Admin/Síndico/Sub-Síndico).

### Body

```json
{
  "observacao": "Texto livre do síndico, até 1000 caracteres",
  "anexos_urls": ["https://.../boleto.pdf"],
  "outras_pendencias_ids": [341, 360]
}
```

| Campo | Obrigatório | Descrição |
|---|---|---|
| `observacao` | não | Texto livre exibido no e-mail (campo dedicado `observacao` no payload de disparo — ver `docs/public-email-dispatch.md`). Máx. 1000 caracteres. |
| `anexos_urls` | não | Até 20 URLs (devem ser URLs de blob já enviadas via `POST /inadimplencia/boletos/upload`). Viram links de download no e-mail (campo `anexos_urls`). |
| `outras_pendencias_ids` | não | Ids de outras receitas em aberto **da mesma unidade** para consolidar numa única cobrança (mesmo e-mail, valor somado). Todas precisam estar `em_aberto` e vinculadas à mesma `id_unidade` da receita principal — caso contrário, `422`. |

### Resposta

```json
{ "message": "Cobrança disparada." }
```
Com `outras_pendencias_ids`, a resposta inclui `pendencias_incluidas: [396, 341, 360]`.

A resposta HTTP é enviada **antes** do disparo de push/e-mail (via `waitUntil()`/`setImmediate()`) — não espera confirmação de entrega. Cada disparo (push e e-mail, por destinatário) é registrado em `tb_fin_cobranca_log`, consultável via `GET /cobrancas`.

### Boleto bancário no e-mail

Se a receita principal tiver uma cobrança bancária vigente (`tb_fin_cobranca_bancaria.situacao` `emitida` ou `paga` — banco integrado, ex: Banco Inter), o payload de e-mail inclui `cobranca.boleto_bancario` com `linha_digitavel`/`codigo_barras`/`pix_copia_cola`. Mesma fonte de dado usada por `GET /financeiro/receitas/{id}/boleto-bancario`. Sem cobrança bancária vigente, o e-mail é enviado normalmente, sem essa seção. Ver contrato completo em `docs/public-email-dispatch.md`.

### Consolidação de pendências

Ao enviar `outras_pendencias_ids`, o e-mail passa a descrever `"<N> pendências consolidadas"` em vez da descrição da receita única, com `cobranca.valor` somando todas, `cobranca.dias_atraso` usando o maior atraso entre elas, e `details['Pendências consolidadas']` listando cada uma (descrição, valor, vencimento). `boleto_bancario`, quando presente, continua se referindo apenas à cobrança bancária da receita **principal** (`{id}` da URL) — pendências consolidadas adicionais não têm boleto bancário individual representado no e-mail.

## `POST /inadimplencia/boletos/upload`

Upload de arquivo (`multipart/form-data`, campo `arquivo`) para o Vercel Blob, usado para gerar as URLs enviadas em `anexos_urls` do `POST /cobrar`. Requer `auth` + perfil gestor.

Resposta:
```json
{ "url": "https://.../cobranca/boletos/condominio-277/202609/....pdf", "blob_path": "...", "nome_arquivo": "boleto.pdf" }
```

## `GET /boletos/download`

Proxy de download do arquivo no Vercel Blob, dado `?url=`. **Sem `auth`** de propósito — é o link clicado pelo morador direto no e-mail de cobrança, sem estar logado. Valida que a URL pertence ao Blob storage configurado e ao prefixo `/cobranca/boletos/` antes de repassar.

## `GET /cobrancas`

Lista o histórico de disparos de cobrança (`tb_fin_cobranca_log`), filtrável por `id_receita`, `id_usuario`, `canal` (`push`/`email`/`sms`), `data_inicio`/`data_fim`. Requer `auth`.
