# Solicitação de 2ª via de boleto — notificação ao síndico

Este documento descreve o fluxo de `POST /api/condominio/financeiro/receitas/{id}/solicitar-2via`, que notifica o síndico/sub-síndico do condomínio por e-mail quando um morador solicita a 2ª via de um boleto sem anexo.

## O front não participa do disparo

O front só chama o endpoint de solicitação; todo o disparo de e-mail é feito pelo backend Node, servidor-a-servidor, contra o mesmo serviço externo de e-mail (repositório separado) já usado pelos demais templates do sistema.

```
Front (POST /receitas/{id}/solicitar-2via)
        │
        ▼
Backend Node — solicitar2ViaBoleto()  (src/controllers/financeiroController.js)
        │  responde 200 imediatamente, e-mail roda depois via waitUntil()
        ▼
emailDispatchService.despacharEmail()  →  POST EMAIL_DISPATCH_URL (serviço externo, PHP)
        │       Authorization: Bearer <PUBLIC_EMAIL_DISPATCH_KEY>
        ▼
Serviço externo resolve o template solicitacao_2via_boleto e envia o e-mail de verdade
```

## Endpoint que aciona o envio

- `POST /api/condominio/financeiro/receitas/{id}/solicitar-2via`
- Sem corpo obrigatório — o morador é identificado pelo token, a receita pelo `{id}` da URL.
- Resposta de sucesso:

```json
{ "success": true, "message": "Solicitação enviada ao síndico." }
```

O disparo do e-mail roda em `waitUntil()`, depois da resposta HTTP já ter sido enviada — não bloqueia nem depende do front esperar (mesmo padrão usado em todos os disparos de e-mail deste backend, necessário pelo runtime serverless da Vercel).

## Regra de acesso

- **Morador**: só pode solicitar para uma receita da própria unidade (`req.id_unidade`, extraído do token). 403 se tentar solicitar para outra unidade.
- **Gestor** (Admin/Sindico/Sub-Sindico): pode solicitar para qualquer receita do condomínio.
- Sem `id_unidade` no token e sem ser gestor → 403 "Acesso negado.".

## Regra de destinatários

Usuários **ativos** do condomínio da receita, com **perfil Sindico ou Sub-Sindico** (`tipo_perfil_id IN ('3', '4')`), com e-mail preenchido — mesma regra já usada no fluxo `reserva_solicitacao` (`src/controllers/condominioController.js`).

Se o condomínio não tiver nenhum síndico/sub-síndico com e-mail cadastrado, o endpoint retorna **422** antes mesmo de tentar enviar, sem consumir a janela de cooldown:

```json
{ "message": "Este condomínio não possui síndico ou sub-síndico com e-mail cadastrado." }
```

## Cooldown de 24h por receita

Para evitar spam ao síndico se o morador clicar o botão várias vezes, cada receita só pode gerar uma nova solicitação a cada 24h. Controlado pela tabela `tb_fin_2via_boleto_log` (`id_condominio, id_receita, id_usuario_solicitante, created_at`).

Se a última solicitação daquela receita tiver menos de 24h, o endpoint retorna **422**:

```json
{ "message": "Já existe uma solicitação de 2ª via recente para esta receita. Tente novamente mais tarde." }
```

O registro de cooldown é gravado **antes** da resposta HTTP (fora do `waitUntil()`), garantindo que uma falha no envio do e-mail não permita reenvios imediatos em sequência.

## Template usado

- `solicitacao_2via_boleto` — precisa ser cadastrado no serviço externo de e-mail (`service/public-email-dispatch.php`, repositório à parte). Antes de existir lá, a chamada falha com 422 "Template de e-mail não suportado" — logado, sem interromper a resposta já enviada ao morador.

## Payload enviado

```json
{
  "_ref": "2via_boleto_277_53",
  "template": "solicitacao_2via_boleto",
  "emails": ["sindico@exemplo.com", "subsindico@exemplo.com"],
  "solicitacao": {
    "morador_nome": "João Silva",
    "unidade": "101",
    "competencia": "julho de 2026",
    "valor": 260.00,
    "condominio_nome": "Condomínio Exemplo"
  }
}
```

- `emails`: array com todos os síndicos/sub-síndicos elegíveis (uma única chamada em lote, não uma por destinatário).
- `unidade`: vem de `tb_condominios_unidades.unidades_bloco`, mesma coluna usada em `GET /api/condominio/financeiro/receitas`.
- `valor`: soma de `valor` + `valor_fundo_reserva` da receita.
- `competencia`: formatada por extenso via `Date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })`.

## Retentativas e falhas

- Erro 5xx do serviço externo → até 3 tentativas (`MAX_RETRIES` em `emailDispatchService.js`).
- Erro 4xx (ex.: template não cadastrado) → não tenta de novo, loga e segue.
- Falha ao enviar o e-mail não afeta a resposta já enviada ao morador (200 antes do `waitUntil()` rodar) nem desfaz o registro de cooldown já gravado.
- Log relevante: `[solicitar2ViaBoleto] Erro ao enviar e-mail: ...`.

## Não existe callback pro front

Não há webhook nem segunda chamada informando se o e-mail foi entregue. A única forma de confirmar o disparo é olhando os logs do servidor.
