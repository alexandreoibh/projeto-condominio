# Webhook bancário: estado atual e como reativar (27/11/2026)

## Estado atual

Desde 27/11/2026, `POST /api/webhook/bancario/:provider` fica **desativado por padrão (fail-closed)**.

Enquanto qualquer uma das condições abaixo faltar, o endpoint responde `404`, não grava nada e não processa nada:

| Requisito | Detalhe |
|---|---|
| `WEBHOOK_BANCARIO_HABILITADO=true` | Chave geral. Fica ausente em produção até a reativação. |
| `WEBHOOK_BANCARIO_PROVIDERS=inter` | Lista separada por vírgula com os providers aceitos. |
| `WEBHOOK_BANCARIO_SECRET` | Pelo menos 32 caracteres aleatórios. Diferente de `JWT_SECRET` e `CRON_QUEUE_KEY`. |
| Validador de contrato | Hoje existe só para o `inter` (`interWebhookHandler.validarPayload`). |

## Contrato aplicado

As checagens rodam nesta ordem, antes de qualquer gravação:

1. **Autenticação:** só pelo header `X-Webhook-Secret`. O segredo na query string (`?k=`) **não é mais aceito**. Sem o header ou com o segredo errado, a resposta é `401`.
2. **Content-Type:** precisa ser `application/json`; fora disso, `415`.
3. **Tamanho:** no máximo 32 KB; acima disso, `413`.
4. **Estrutura:** um array com 1 a 50 eventos. Fora disso, `400`.
   - Campos permitidos: `codigoSolicitacao`, `seuNumero`, `situacao`, `dataHoraSituacao`, `valorTotalRecebido`, `origemRecebimento`, `nossoNumero`, `codigoBarras`, `linhaDigitavel`, `txid` e `pixCopiaECola`.
   - Cada valor é string ou número, com no máximo 200 caracteres.
   - `codigoSolicitacao` deve casar com `[A-Za-z0-9-]{1,64}`.
   - `situacao` deve estar no conjunto conhecido.
5. **Log:** grava só um resumo, com o sha256 do corpo, a quantidade de eventos e o par `codigoSolicitacao`/`situacao` de cada um. Dos headers, só `content-type`, `user-agent` e o id da requisição. O payload bruto não é gravado.
6. **Processamento:** a situação aplicada vem sempre da reconsulta à API do banco, feita com a credencial da própria cobrança, e só se a integração estiver ativa (`ib.ativo = true`).
7. **Idempotência:** eventos duplicados no mesmo lote são descartados, e a baixa é um `UPDATE … AND situacao <> 'paga' RETURNING id`. Com isso, a baixa ocorre uma única vez, mesmo com chamadas concorrentes.

## Pendência para reativar o Banco Inter

O mecanismo oficial que o Inter usa para autenticar as chamadas de webhook **não foi confirmado**. A hipótese mais provável é mTLS, com o certificado do Inter apresentado ao receptor.

A Vercel não valida certificado de cliente na entrada (não há mTLS de entrada). Por isso:

1. Confirmar no portal oficial do Inter (developers.inter.co) o mecanismo de autenticação do webhook de Cobrança v3 e a CA/certificado que o Inter apresenta.
2. Se for mTLS, publicar um proxy reverso (VPS com nginx) que:
   - valide o certificado de cliente do Inter (`ssl_verify_client on` com a CA oficial);
   - repasse a chamada à Vercel com o header `X-Webhook-Secret`;
   - remova qualquer `X-Webhook-Secret` vindo de fora.
3. Revisar a lista de campos permitidos contra o contrato oficial. Campo novo do Inter gera `400`.
4. Na Vercel, definir `WEBHOOK_BANCARIO_SECRET`, `WEBHOOK_BANCARIO_PROVIDERS=inter` e, por último, `WEBHOOK_BANCARIO_HABILITADO=true`.
5. Reconectar a integração no eMorador e só então cadastrar no Inter a URL do proxy, nunca a da Vercel diretamente.
6. A reconciliação (`POST /api/webhook/bancario/reconciliar`, que usa `X-Cron-Queue-Key`) continua sendo a rede de segurança caso algum webhook se perca.
