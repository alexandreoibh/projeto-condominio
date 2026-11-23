'use strict';

// Nenhuma chamada real ao Banco Inter: o registry de providers é mockado.
const mockConsultarCobranca = jest.fn();
jest.mock('../src/integrations/bankingProviderRegistry', () => {
  const interWebhookHandler = jest.requireActual('../src/integrations/inter/interWebhookHandler');
  return {
    getProvider: () => ({
      processarWebhook: interWebhookHandler.processarWebhook,
      consultarCobranca: (...args) => mockConsultarCobranca(...args),
      consultarSaldo: jest.fn(async () => ({ disponivel: 1000 })),
      consultarExtrato: jest.fn(async () => [])
    }),
    listarProvidersDisponiveis: () => ['inter']
  };
});

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { assinarLinkDownload } = require('../src/helpers/blobUrl');
const { sessao, PERFIL } = require('./helpers/tokens');

const { on, callsMatching } = fakeDb._fake;
const BLOB = 'https://teststore.private.blob.vercel-storage.com';
const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  mockConsultarCobranca.mockReset();
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/pdf' },
    arrayBuffer: async () => Buffer.from('%PDF-1.4 teste')
  }));
});

describe('Integração bancária: autenticação e perfil', () => {
  test('saldo e extrato exigem autenticação', async () => {
    expect((await request(app).get('/api/condominio/financeiro/integracao-bancaria/1/saldo')).status).toBe(401);
  });

  test('morador, portaria e colaborador não veem saldo, extrato nem credenciais', async () => {
    for (const perfil of [PERFIL.MORADOR, PERFIL.PORTARIA, PERFIL.COLABORADOR]) {
      const token = sessao({ id: 10, perfil });
      expect((await auth(request(app).get('/api/condominio/financeiro/integracao-bancaria/1/saldo'), token)).status).toBe(403);
      expect((await auth(request(app).get('/api/condominio/financeiro/integracao-bancaria/1/extrato?dataInicio=2026-11-01&dataFim=2026-11-22'), token)).status).toBe(403);
      expect((await auth(request(app).get('/api/condominio/financeiro/integracao-bancaria'), token)).status).toBe(403);
    }
  });

  test('síndico só usa a integração do próprio condomínio (filtro do token)', async () => {
    on(/FROM "condominio-bh"\.tb_fin_integracao_bancaria\s+WHERE id = :id AND id_condominio = :idCondominio/, () => []);
    const res = await auth(request(app).get('/api/condominio/financeiro/integracao-bancaria/9/saldo'), sessao({ id: 20, perfil: PERFIL.SINDICO, condominio: 1 }));
    expect(res.status).toBe(404);
    expect(callsMatching(/tb_fin_integracao_bancaria\s+WHERE id = :id/)[0].replacements.idCondominio).toBe(1);
  });

  test('morador não emite boleto', async () => {
    expect((await auth(request(app).post('/api/condominio/financeiro/receitas/1/boleto-bancario'), sessao({ id: 10 }))).status).toBe(403);
  });

  test('morador não consulta boleto de outra unidade', async () => {
    on(/SELECT id_unidade, id_usuario FROM "condominio-bh"\.tb_fin_receitas/, () => [{ id_unidade: 300, id_usuario: 99 }]);
    const res = await auth(request(app).get('/api/condominio/financeiro/receitas/1/boleto-bancario'), sessao({ id: 10, unidade: 100 }));
    expect(res.status).toBe(403);
    expect(callsMatching(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria/)).toHaveLength(0);
  });
});

describe('Webhook bancário', () => {
  const cobrancaEmitida = { id_cobranca: 7, id_condominio: 1, id_receita: 3, cb_provider: 'inter', situacao: 'emitida', id_externo: 'abc' };

  test('payload forjado "PAGO" não dá baixa se o banco diz que está em aberto', async () => {
    on(/INSERT INTO "condominio-bh"\.tb_webhook_bancario_log/, () => [[{ id: 1 }], 1]);
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    mockConsultarCobranca.mockResolvedValue({ cobranca: { situacao: 'A_RECEBER' } });

    const res = await request(app).post('/api/webhook/bancario/inter').send([{ codigoSolicitacao: 'abc', situacao: 'PAGO' }]);
    expect(res.status).toBe(200);
    await global.aguardarPendentes();

    expect(mockConsultarCobranca).toHaveBeenCalledTimes(1);
    expect(callsMatching(/SET situacao = 'paga'/)).toHaveLength(0);
    expect(callsMatching(/SET situacao = 'pago'/)).toHaveLength(0);
  });

  test('pagamento confirmado pelo banco é aplicado e auditado', async () => {
    on(/INSERT INTO "condominio-bh"\.tb_webhook_bancario_log/, () => [[{ id: 1 }], 1]);
    on(/FROM "condominio-bh"\.tb_fin_cobranca_bancaria cb\s+JOIN/, () => [cobrancaEmitida]);
    mockConsultarCobranca.mockResolvedValue({ cobranca: { situacao: 'RECEBIDO' } });

    await request(app).post('/api/webhook/bancario/inter').send([{ codigoSolicitacao: 'abc', situacao: 'RECEBIDO' }]);
    await global.aguardarPendentes();

    expect(callsMatching(/SET situacao = 'paga'/)).toHaveLength(1);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/)).toHaveLength(1);
  });

  test('headers sensíveis não são gravados no log', async () => {
    on(/INSERT INTO "condominio-bh"\.tb_webhook_bancario_log/, () => [[{ id: 1 }], 1]);
    await request(app).post('/api/webhook/bancario/inter').set('Authorization', 'Bearer segredo').send([]);
    const log = callsMatching(/INSERT INTO "condominio-bh"\.tb_webhook_bancario_log/)[0];
    expect(log.replacements.headersRecebidos).not.toContain('segredo');
  });

  test('com WEBHOOK_BANCARIO_SECRET definido, chamada sem segredo → 401', async () => {
    process.env.WEBHOOK_BANCARIO_SECRET = 'segredo-webhook-teste';
    try {
      expect((await request(app).post('/api/webhook/bancario/inter').send([])).status).toBe(401);
      on(/INSERT INTO "condominio-bh"\.tb_webhook_bancario_log/, () => [[{ id: 1 }], 1]);
      expect((await request(app).post('/api/webhook/bancario/inter?k=segredo-webhook-teste').send([])).status).toBe(200);
    } finally {
      delete process.env.WEBHOOK_BANCARIO_SECRET;
    }
  });
});

describe('Download de boleto (link do e-mail)', () => {
  const url = `${BLOB}/cobranca/boletos/condominio-1/202611/123_abc.pdf`;
  const rota = (q) => `/api/condominio/financeiro/boletos/download?${q}`;

  test('link sem assinatura (formato antigo) → 403, sem fetch', async () => {
    const res = await request(app).get(rota(`url=${encodeURIComponent(url)}`));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('host falso que começa com o host do Blob → 400, token nunca enviado', async () => {
    const falso = `${BLOB}.atacante.tld/cobranca/boletos/condominio-1/202611/x.pdf`;
    const { exp, sig } = assinarLinkDownload(falso);
    const res = await request(app).get(rota(`url=${encodeURIComponent(falso)}&exp=${exp}&sig=${sig}`));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('outro caminho do Blob (fora de cobranca/boletos) → 400', async () => {
    const outro = `${BLOB}/prod/condominios/2/financeiro/despesas/1/nf.pdf?x=/cobranca/boletos/`;
    const res = await request(app).get(rota(`url=${encodeURIComponent(outro)}`));
    expect(res.status).toBe(400);
  });

  test('link assinado válido → 200 (PDF)', async () => {
    const { exp, sig } = assinarLinkDownload(url);
    const res = await request(app).get(rota(`url=${encodeURIComponent(url)}&exp=${exp}&sig=${sig}`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(global.fetch.mock.calls[0][0]).toBe(url);
  });

  test('assinatura de um boleto não abre outro', async () => {
    const { exp, sig } = assinarLinkDownload(url);
    const outro = `${BLOB}/cobranca/boletos/condominio-2/202611/999.pdf`;
    const res = await request(app).get(rota(`url=${encodeURIComponent(outro)}&exp=${exp}&sig=${sig}`));
    expect(res.status).toBe(403);
  });

  test('link expirado → 403', async () => {
    const { exp, sig } = assinarLinkDownload(url, -10);
    expect((await request(app).get(rota(`url=${encodeURIComponent(url)}&exp=${exp}&sig=${sig}`))).status).toBe(403);
  });
});

describe('Download de documento financeiro', () => {
  const rota = (u) => `/api/condominio/financeiro/documentos/download?url=${encodeURIComponent(u)}`;

  test('gestor do condomínio 1 não baixa documento do condomínio 2', async () => {
    const res = await auth(request(app).get(rota(`${BLOB}/prod/condominios/2/financeiro/despesas/1/nf.pdf`)), sessao({ id: 20, perfil: PERFIL.SINDICO, condominio: 1 }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('morador não burla a checagem de unidade pela query string', async () => {
    on(/SELECT id_unidade FROM "condominio-bh"\.tb_fin_receitas/, (r) => (r.id === 5 ? [{ id_unidade: 100 }] : [{ id_unidade: 300 }]));
    const ataque = `${BLOB}/prod/condominios/1/financeiro/receitas/8/doc.pdf?/financeiro/receitas/5/`;
    const res = await auth(request(app).get(rota(ataque)), sessao({ id: 10, condominio: 1, unidade: 100 }));
    expect(res.status).toBe(403);
  });
});
