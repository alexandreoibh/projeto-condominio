'use strict';

// Auditoria SQL Injection 27/11/2026 — F2, F3, F5, F6, F7 e eco de payload no 422.

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sessao, PERFIL } = require('./helpers/tokens');
const FinanceiroController = require('../src/controllers/financeiroController');

const { on, state, callsMatching } = fakeDb._fake;
const auth = (req, token) => req.set('Authorization', `Bearer ${token}`);
const sindico = (extra = {}) => sessao({ id: 20, perfil: PERFIL.SINDICO, condominio: 1, ...extra });
const PAYLOADS = ["' OR 1=1--", "1; DROP TABLE \"condominio-bh\".\"tb-usuarios\";--", "\\' OR '1'='1", "x' UNION SELECT senha_hash FROM \"condominio-bh\".\"tb-usuarios\"--", '$1'];

describe('F2: query com array/objeto é rejeitada antes do banco', () => {
  test.each([
    ['array (parâmetro repetido)', '/api/condominio/financeiro/receitas?situacao=pago&situacao=pago'],
    ['objeto (qs aninhado)', '/api/condominio/financeiro/receitas?categoria[x]=1'],
    ['objeto em rota de manutenção', '/api/condominio/manutencao/rotinas?status_rotina[$ne]=x'],
    ['array em rota pública', '/api/condominio/status?a=1&a=2']
  ])('%s → 400 e nenhuma consulta', async (_nome, url) => {
    const res = await auth(request(app).get(url), sindico());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Parâmetro inválido.' });
    // O guard roda antes do auth: nem a consulta de sessão acontece.
    expect(state.calls).toHaveLength(0);
  });

  test('PATCH rotina com status_rotina array no body → 400 sem UPDATE', async () => {
    const res = await auth(request(app).patch('/api/condominio/manutencao/rotinas/5'), sindico()).send({ status_rotina: ['PENDENTE'] });
    expect(res.status).toBe(400);
    expect(callsMatching(/UPDATE "condominio-bh"\.tb_manutencao_rotina/)).toHaveLength(0);
  });

  test.each(PAYLOADS)('payload %p em filtro texto vai só nos replacements, nunca no SQL', async (payload) => {
    on(/FROM "condominio-bh"\.tb_fin_receitas r/, () => []);
    const res = await auth(request(app).get('/api/condominio/financeiro/receitas').query({ categoria: payload.slice(0, 60) }), sindico());
    expect(res.status).toBe(200);
    const chamadas = callsMatching(/tb_fin_receitas r/);
    expect(chamadas.length).toBeGreaterThan(0);
    for (const chamada of chamadas) {
      expect(chamada.sql).not.toContain(payload.slice(0, 60));
      expect(chamada.replacements.categoria).toBe(payload.slice(0, 60));
      expect(chamada.replacements.id_condominio).toBe(1);
    }
  });
});

describe('422 não devolve a entrada recebida', () => {
  test.each(PAYLOADS)('situacao=%p → 422 sem eco e sem consulta de negócio', async (payload) => {
    const res = await auth(request(app).get('/api/condominio/financeiro/receitas').query({ situacao: payload }), sindico());
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain(payload);
    expect(res.body.errors[0]).not.toHaveProperty('value');
    expect(res.body.errors[0].param).toBe('situacao');
    expect(callsMatching(/tb_fin_receitas/)).toHaveLength(0);
  });
});

describe('F6: ordenação por allowlist', () => {
  test('sort=constructor → 422 na rota', async () => {
    const res = await auth(request(app).get('/api/condominio/financeiro/receitas?sort=constructor'), sindico());
    expect(res.status).toBe(422);
    expect(callsMatching(/tb_fin_receitas/)).toHaveLength(0);
  });

  test('_clausulaOrdenacao ignora chaves do protótipo', () => {
    const ctrl = new FinanceiroController();
    const whitelist = { id: 'r.id' };
    for (const sort of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(ctrl._clausulaOrdenacao({ query: { sort } }, whitelist, 'x', 'PADRAO')).toBe('PADRAO');
    }
    expect(ctrl._clausulaOrdenacao({ query: { sort: 'id', order: 'desc' } }, whitelist, 'r.x', 'PADRAO')).toBe('r.id DESC, r.x');
  });
});

describe('F3: webhook bancário', () => {
  test('provider fora da allowlist → 404 e nada gravado', async () => {
    const res = await request(app).post("/api/webhook/bancario/x';DROP TABLE t;--").send({ a: 1 });
    expect(res.status).toBe(404);
    expect(callsMatching(/tb_webhook_bancario_log/)).toHaveLength(0);
  });

  test('webhook desativado por padrão: 404 sem gravar (detalhes em webhook-bancario.test.js)', async () => {
    const res = await request(app).post('/api/webhook/bancario/inter').send([{ codigoSolicitacao: 'abc', situacao: 'PAGO' }]);
    expect(res.status).toBe(404);
    expect(callsMatching(/tb_webhook_bancario_log/)).toHaveLength(0);
  });
});

describe('F5: isolamento em criarDashboardRegistro', () => {
  test('síndico com token sem condomínio não grava no condomínio do body', async () => {
    const res = await auth(request(app).post('/api/condominio/dashboard/registros'), sindico({ condominio: null }))
      .send({ titulo: 'x', id_condominio: 2 });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Token sem id_condominio/);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_dashboard_registro/)).toHaveLength(0);
  });

  test('data como objeto → 400 sem INSERT', async () => {
    const res = await auth(request(app).post('/api/condominio/dashboard/registros'), sindico())
      .send({ titulo: 'x', data_inicio: { a: 1 } });
    expect(res.status).toBe(400);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_dashboard_registro/)).toHaveLength(0);
  });
});

describe('F7: erro interno/SQL não é exposto em produção', () => {
  const ambiente = { ...process.env };
  afterEach(() => { process.env = { ...ambiente }; });

  const carregarApp = () => {
    let appProd;
    jest.isolateModules(() => {
      // mesma instância de banco falso dos demais testes
      jest.doMock('../src/database/postgres', () => fakeDb);
      appProd = require('../src/app');
    });
    return appProd;
  };

  test('VERCEL_ENV=production ignora EXPOR_DETALHE_ERRO=true', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.EXPOR_DETALHE_ERRO = 'true';
    const appProd = carregarApp();
    on(/tb_fin_grupo_receita/, () => {
      const erro = new Error('syntax error at or near "OR" (relation "tb-usuarios")');
      erro.sql = 'SELECT * FROM "condominio-bh"."tb-usuarios"';
      throw erro;
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await auth(request(appProd).get('/api/condominio/financeiro/grupo-receita'), sindico());
    spy.mockRestore();
    expect(res.status).toBe(500);
    const texto = JSON.stringify(res.body);
    expect(texto).not.toMatch(/syntax error|tb-usuarios|SELECT/);
    expect(res.body).not.toHaveProperty('detail');
  });
});
