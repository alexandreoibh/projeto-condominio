'use strict';

// Webhook bancário fail-closed (auditoria 27/11/2026, F3). Sem chamada real ao
// banco: o registry de providers é mockado.
const mockConsultarCobranca = jest.fn();
jest.mock('../src/integrations/bankingProviderRegistry', () => {
  const interWebhookHandler = jest.requireActual('../src/integrations/inter/interWebhookHandler');
  return {
    getProvider: () => ({
      processarWebhook: interWebhookHandler.processarWebhook,
      consultarCobranca: (...args) => mockConsultarCobranca(...args)
    }),
    listarProvidersDisponiveis: () => ['inter', 'itau']
  };
});

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');

const { on, callsMatching } = fakeDb._fake;
const SEGREDO = 'segredo-webhook-teste-com-32-caracteres!!';
const URL = '/api/webhook/bancario/inter';
const cobrancaEmitida = { id_cobranca: 7, id_condominio: 1, id_receita: 3, cb_provider: 'inter', situacao: 'emitida', id_externo: 'abc' };
const ambiente = { ...process.env };

const habilitar = () => {
  process.env.WEBHOOK_BANCARIO_HABILITADO = 'true';
  process.env.WEBHOOK_BANCARIO_PROVIDERS = 'inter';
  process.env.WEBHOOK_BANCARIO_SECRET = SEGREDO;
};
const enviar = (corpo, { segredo = SEGREDO, url = URL } = {}) => {
  const req = request(app).post(url);
  if (segredo) req.set('X-Webhook-Secret', segredo);
  return req.send(corpo);
};
const inserts = () => callsMatching(/INSERT INTO "condominio-bh"\.tb_webhook_bancario_log/);
const eventoPago = [{ codigoSolicitacao: 'abc', situacao: 'PAGO' }];

beforeEach(() => mockConsultarCobranca.mockReset());
afterEach(() => { process.env = { ...ambiente }; });

describe('Habilitação e autenticação (fail-closed)', () => {
  test('desativado por padrão: 404 e nada gravado, mesmo com segredo correto', async () => {
    process.env.WEBHOOK_BANCARIO_SECRET = SEGREDO;
    expect((await enviar(eventoPago)).status).toBe(404);
    expect(inserts()).toHaveLength(0);
    expect(mockConsultarCobranca).not.toHaveBeenCalled();
  });

  test('habilitado com segredo ausente ou curto continua 404', async () => {
    habilitar();
    process.env.WEBHOOK_BANCARIO_SECRET = 'curto';
    expect((await enviar(eventoPago, { segredo: 'curto' })).status).toBe(404);
    delete process.env.WEBHOOK_BANCARIO_SECRET;
    expect((await enviar(eventoPago, { segredo: null })).status).toBe(404);
    expect(inserts()).toHaveLength(0);
  });

  test('provider fora de WEBHOOK_BANCARIO_PROVIDERS ou sem validador de contrato → 404', async () => {
    habilitar();
    process.env.WEBHOOK_BANCARIO_PROVIDERS = 'itau';
    // itau está no registry mas não tem validador de contrato
    expect((await enviar(eventoPago, { url: '/api/webhook/bancario/itau' })).status).toBe(404);
    expect((await enviar(eventoPago)).status).toBe(404);
    expect(inserts()).toHaveLength(0);
  });

  test('sem header, segredo errado ou segredo só na query → 401 sem gravar', async () => {
    habilitar();
    expect((await enviar(eventoPago, { segredo: null })).status).toBe(401);
    expect((await enviar(eventoPago, { segredo: 'x'.repeat(40) })).status).toBe(401);
    const viaQuery = await enviar(eventoPago, { segredo: null, url: `${URL}?k=${encodeURIComponent(SEGREDO)}` });
    expect(viaQuery.status).toBe(401);
    expect(inserts()).toHaveLength(0);
  });

  test('método diferente de POST não é aceito', async () => {
    habilitar();
    expect((await request(app).get(URL).set('X-Webhook-Secret', SEGREDO)).status).toBe(404);
    expect((await request(app).put(URL).set('X-Webhook-Secret', SEGREDO).send(eventoPago)).status).toBe(404);
    expect(inserts()).toHaveLength(0);
  });
});

describe('Validação do contrato antes de gravar', () => {
  test('Content-Type diferente de JSON → 415', async () => {
    habilitar();
    const res = await request(app).post(URL).set('X-Webhook-Secret', SEGREDO).set('Content-Type', 'text/plain').send('codigoSolicitacao=abc');
    expect(res.status).toBe(415);
    expect(inserts()).toHaveLength(0);
  });

  test('payload acima de 32 KB → 413', async () => {
    habilitar();
    const eventos = Array.from({ length: 50 }, (_, i) => ({
      codigoSolicitacao: `c${i}`, situacao: 'PAGO',
      pixCopiaECola: 'A'.repeat(200), linhaDigitavel: 'B'.repeat(200), codigoBarras: 'C'.repeat(200), seuNumero: 'D'.repeat(200)
    }));
    expect((await enviar(eventos)).status).toBe(413);
    expect(inserts()).toHaveLength(0);
  });

  test.each([
    ['objeto em vez de array', { codigoSolicitacao: 'abc', situacao: 'PAGO' }],
    ['array vazio', []],
    ['mais de 50 eventos', Array.from({ length: 51 }, (_, i) => ({ codigoSolicitacao: `c${i}`, situacao: 'PAGO' }))],
    ['campo inesperado (id_condominio)', [{ codigoSolicitacao: 'abc', situacao: 'PAGO', id_condominio: 2 }]],
    ['situação desconhecida', [{ codigoSolicitacao: 'abc', situacao: "PAGO' OR 1=1--" }]],
    ['codigoSolicitacao malicioso', [{ codigoSolicitacao: "abc' OR 1=1--", situacao: 'PAGO' }]],
    ['tipo inválido', [{ codigoSolicitacao: 'abc', situacao: 'PAGO', valorTotalRecebido: { $gt: 0 } }]],
    ['campo longo demais', [{ codigoSolicitacao: 'abc', situacao: 'PAGO', seuNumero: 'x'.repeat(201) }]]
  ])('%s → 400 sem gravar nem processar', async (_nome, corpo) => {
    habilitar();
    expect((await enviar(corpo)).status).toBe(400);
    expect(inserts()).toHaveLength(0);
    expect(mockConsultarCobranca).not.toHaveBeenCalled();
  });
});

describe('Processamento', () => {
  test('payload forjado "PAGO" não dá baixa se o banco diz que está em aberto', async () => {
    habilitar();
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    mockConsultarCobranca.mockResolvedValue({ cobranca: { situacao: 'A_RECEBER' } });

    expect((await enviar(eventoPago)).status).toBe(200);
    await global.aguardarPendentes();

    expect(mockConsultarCobranca).toHaveBeenCalledTimes(1);
    expect(callsMatching(/SET situacao = 'paga'/)).toHaveLength(0);
    expect(callsMatching(/SET situacao = 'pago'/)).toHaveLength(0);
  });

  test('pagamento confirmado pelo banco é aplicado e auditado, só com integração ativa', async () => {
    habilitar();
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    on(/SET situacao = 'paga'[\s\S]*RETURNING id/, () => [{ id: 7 }]);
    mockConsultarCobranca.mockResolvedValue({ cobranca: { situacao: 'RECEBIDO' } });

    await enviar([{ codigoSolicitacao: 'abc', situacao: 'RECEBIDO' }]);
    await global.aguardarPendentes();

    expect(callsMatching(/tb_fin_cobranca_bancaria cb\s+JOIN[\s\S]*ib\.ativo = true/)).toHaveLength(1);
    expect(callsMatching(/SET situacao = 'paga'[\s\S]*AND situacao <> 'paga'/)).toHaveLength(1);
    expect(callsMatching(/SET situacao = 'pago'/)).toHaveLength(1);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/)).toHaveLength(1);
  });

  test('integração inativa: cobrança não encontrada pelo JOIN, nada é baixado', async () => {
    habilitar();
    // ib.ativo = true no JOIN → sem linha para integração desativada
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => []);
    await enviar(eventoPago);
    await global.aguardarPendentes();
    expect(mockConsultarCobranca).not.toHaveBeenCalled();
    expect(callsMatching(/SET situacao = 'paga'/)).toHaveLength(0);
  });

  test('idempotência: duplicado no lote processa uma vez; baixa já feita não repete', async () => {
    habilitar();
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    on(/SET situacao = 'paga'[\s\S]*RETURNING id/, () => []); // outra execução já baixou
    mockConsultarCobranca.mockResolvedValue({ cobranca: { situacao: 'RECEBIDO' } });

    await enviar([{ codigoSolicitacao: 'abc', situacao: 'RECEBIDO' }, { codigoSolicitacao: 'abc', situacao: 'RECEBIDO' }]);
    await global.aguardarPendentes();

    expect(mockConsultarCobranca).toHaveBeenCalledTimes(1);
    expect(callsMatching(/SET situacao = 'pago'/)).toHaveLength(0);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/)).toHaveLength(0);
  });

  test('log guarda só resumo e metadados, nunca o payload bruto nem headers sensíveis', async () => {
    habilitar();
    await request(app).post(URL)
      .set('X-Webhook-Secret', SEGREDO)
      .set('Authorization', 'Bearer segredo-abc')
      .set('X-Evil', '<script>alert(1)</script>')
      .set('User-Agent', '<script>alert(1)</script>')
      .send([{ codigoSolicitacao: 'abc', situacao: 'PAGO', pixCopiaECola: 'conteudo-que-nao-deve-ir-ao-log' }]);
    const [log] = inserts();
    expect(log.replacements.payloadBruto).not.toContain('conteudo-que-nao-deve-ir-ao-log');
    const resumo = JSON.parse(log.replacements.payloadBruto);
    expect(resumo).toMatchObject({ qtd: 1, eventos: [{ codigoSolicitacao: 'abc', situacao: 'PAGO' }] });
    expect(resumo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(log.replacements.headersRecebidos).not.toMatch(/segredo|<script|x-evil/i);
  });
});

describe('Atomicidade e associação correta', () => {
  const pagar = async () => {
    habilitar();
    mockConsultarCobranca.mockResolvedValue({ cobranca: { situacao: 'RECEBIDO' } });
    await enviar([{ codigoSolicitacao: 'abc', situacao: 'RECEBIDO' }]);
    await global.aguardarPendentes();
  };

  test('baixa da cobrança e da receita na mesma transação, com receita/condomínio do banco', async () => {
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    on(/SET situacao = 'paga'[\s\S]*RETURNING id, id_receita, id_condominio/, () => [{ id: 7, id_receita: 3, id_condominio: 1 }]);
    await pagar();
    const [cobranca] = callsMatching(/SET situacao = 'paga'/);
    const [receita] = callsMatching(/UPDATE "condominio-bh"\.tb_fin_receitas/);
    expect(cobranca.options.transaction).toBeTruthy();
    expect(receita.options.transaction).toBe(cobranca.options.transaction);
    expect(cobranca.options.transaction.finished).toBe('commit');
    expect(receita.replacements).toEqual({ idReceita: 3, idCondominio: 1 });
  });

  test('UPDATE condicional sem linha afetada → rollback, receita intocada', async () => {
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    on(/SET situacao = 'paga'[\s\S]*RETURNING id/, () => []);
    await pagar();
    const [cobranca] = callsMatching(/SET situacao = 'paga'/);
    expect(cobranca.options.transaction.finished).toBe('rollback');
    expect(callsMatching(/UPDATE "condominio-bh"\.tb_fin_receitas/)).toHaveLength(0);
  });

  test('falha na baixa da receita desfaz a baixa da cobrança', async () => {
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    on(/SET situacao = 'paga'[\s\S]*RETURNING id/, () => [{ id: 7, id_receita: 3, id_condominio: 1 }]);
    on(/UPDATE "condominio-bh"\.tb_fin_receitas/, () => { throw new Error('falha simulada'); });
    await pagar();
    const [cobranca] = callsMatching(/SET situacao = 'paga'/);
    expect(cobranca.options.transaction.finished).toBe('rollback');
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/)).toHaveLength(0);
  });

  test('id_externo ambíguo (duas cobranças) → nenhuma reconsulta nem baixa', async () => {
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida, { ...cobrancaEmitida, id_cobranca: 8, id_condominio: 2 }]);
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await pagar();
    aviso.mockRestore();
    expect(callsMatching(/tb_fin_cobranca_bancaria cb\s+JOIN[\s\S]*LIMIT 2/)).toHaveLength(1);
    expect(mockConsultarCobranca).not.toHaveBeenCalled();
    expect(callsMatching(/SET situacao = 'paga'/)).toHaveLength(0);
  });
});
