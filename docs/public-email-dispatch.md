# Contrato de disparo de e-mail — `POST /service/public-email-dispatch.php`

Este documento cobre os payloads enviados pelo backend Node ao serviço externo de e-mail (`EMAIL_DISPATCH_URL`, repositório PHP à parte), por template. Para o fluxo geral (retry, autenticação, quem dispara) ver `docs/email-dispatch.md`.

## Template `cobranca_inadimplente`

Disparado por `POST /api/condominio/financeiro/inadimplencia/{id}/cobrar` (`cobrarInadimplente` em `src/controllers/financeiroController.js`), uma chamada por destinatário elegível (moradores ativos da unidade da receita).

### Payload

```json
{
  "_ref": "cobranca_277_396",
  "template": "cobranca_inadimplente",
  "emails": ["morador@example.com"],
  "cobranca": {
    "nome": "Alex Diegao",
    "descricao": "Juros por Atraso - 101 – Alex Diegao",
    "valor": 99,
    "data_vencimento": "2026-10-01",
    "dias_atraso": 15,
    "condominio_nome": "Edificio e-Morador Dev",
    "boleto_bancario": {
      "linha_digitavel": "00000034867278349321235241084748773802099534522",
      "codigo_barras": "00000034867278812141896721755606390861489022",
      "pix_copia_cola": "000201010212261010014BR.GOV.BCB.PIX..."
    }
  },
  "observacao": "Texto livre digitado pelo síndico na tela de cobrança",
  "anexos_urls": [
    "https://back-projeto-condominio.vercel.app/api/condominio/financeiro/boletos/download?url=..."
  ],
  "details": {
    "Condomínio": "Edificio e-Morador Dev",
    "Morador": "Alex Diegao",
    "Descrição": "Juros por Atraso - 101 – Alex Diegao",
    "Valor": "R$ 99.00",
    "Dias de atraso": "15",
    "Vencimento": "2026-10-01"
  },
  "link": "https://back-projeto-condominio.vercel.app/api/condominio/financeiro/boletos/download?url=..."
}
```

### Campos

| Campo | Sempre presente? | Descrição |
|---|---|---|
| `_ref` | sim | `cobranca_<id_condominio>_<ids das receitas envolvidas, separadas por ->` — idempotência/depuração no serviço externo. |
| `template` | sim | Fixo `"cobranca_inadimplente"`. |
| `emails` | sim | Array de e-mails do(s) destinatário(s) daquela chamada (moradores ativos da unidade). |
| `cobranca.nome` | sim | Nome do morador da receita principal. |
| `cobranca.descricao` | sim | Descrição da receita, ou `"<N> pendências consolidadas"` quando `outras_pendencias_ids` foi usado. |
| `cobranca.valor` | sim | Valor total (soma de todas as pendências consolidadas, se houver). Number, não string. |
| `cobranca.data_vencimento` | sim | Vencimento da receita principal (`YYYY-MM-DD`). |
| `cobranca.dias_atraso` | sim | Maior número de dias de atraso entre as pendências enviadas (Number). |
| `cobranca.condominio_nome` | sim | Nome do condomínio. |
| `cobranca.boleto_bancario` | **só quando existe** | Presente apenas se a receita principal tiver uma cobrança bancária com `situacao` `emitida` ou `paga` em `tb_fin_cobranca_bancaria` (banco integrado, ex: Banco Inter). Ver seção dedicada abaixo. |
| `observacao` | **só quando enviada** | Texto livre digitado pelo síndico no campo `observacao` do `POST /cobrar`. Campo de topo, não fica mais dentro de `details`. |
| `anexos_urls` | **só quando há anexos** | Array de URLs (já resolvidas para o endpoint de download do backend, não a URL bruta enviada pelo front) dos boletos/comprovantes anexados via `anexos_urls` no `POST /cobrar`. |
| `details` | sim | Only os pares chave→valor de exibição: `Condomínio`, `Morador`, `Descrição`, `Valor`, `Dias de atraso`, `Vencimento` — e `Pendências consolidadas` quando a cobrança agrega mais de uma receita. **Nunca** contém observação nem links de anexo. |
| `link` | só quando há anexos | Primeira URL de `anexos_urls`, mantido por compatibilidade com o serviço externo (que hoje só usa um link de destaque no corpo do e-mail). |

### `cobranca.boleto_bancario`

Reaproveita a mesma fonte de dado de `GET /api/condominio/financeiro/receitas/{id}/boleto-bancario` — a cobrança bancária vigente (mais recente com `situacao` `emitida` ou `paga`) vinculada à receita principal em `tb_fin_cobranca_bancaria`.

```json
{
  "linha_digitavel": "00000034867278349321235241084748773802099534522",
  "codigo_barras": "00000034867278812141896721755606390861489022",
  "pix_copia_cola": null
}
```

- Qualquer um dos três campos pode vir `null` (ex: `pix_copia_cola` quando o Inter não retornou PIX para aquela cobrança).
- **Ausência do campo `boleto_bancario`** (não `null` — o campo inteiro não existe no objeto `cobranca`) significa que a receita não tem boleto bancário emitido — o e-mail deve funcionar normalmente sem essa seção.

### Retentativas e falhas

Mesmo comportamento documentado em `docs/email-dispatch.md`: até 3 tentativas em erro 5xx, sem retry em 4xx, falha de um destinatário não interrompe os demais. Disparo via `waitUntil()` depois da resposta HTTP de `POST /cobrar` já ter sido enviada.
