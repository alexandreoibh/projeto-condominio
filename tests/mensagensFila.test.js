'use strict';

// Fila de mensagens (tb_mensagens_fila): reserva atômica, desfechos de envio,
// WhatsApp desativado, isolamento e guarda X-Cron-Queue-Key.
// Banco simulado em memória (fakeDb) e fetch mockado: nada sai para a rede.

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { sessao, PERFIL } = require('./helpers/tokens');
const emailService = require('../src/service/emailDispatchService');

const { on, callsMatching } = fakeDb._fake;
const ROTA = '/api/condominio/mensagens/fila/processar';
const CHAVE = 'chave-cron-de-teste-0123456789';
const TOKEN_BOT = '123456:SEGREDO_DO_BOT_abcdef';

const ENV_ORIGINAL = { ...process.env };
beforeEach(() => {
  process.env.CRON_QUEUE_KEY = CHAVE;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN_BOT;
  process.env.WHATSAPP_DISPATCH_URL = 'https://whatsapp.teste.local/dispatch';
  process.env.PUBLIC_EMAIL_DISPATCH_KEY = 'chave-email-teste';
  delete process.env.WHATSAPP_ENABLED;
  delete process.env.FILA_TEMPO_MAX_MS;
  emailService.enviarEmailFila.mockClear();
  emailService.enviarEmailFila.mockImplementation(async () => ({ resultado: 'aceito', http_status: 200, codigo: null }));
});
afterAll(() => { process.env = ENV_ORIGINAL; });

// ---------------------------------------------------------------- tabela fake
function instalarFila({ itens = [], usuarios = [], falharFinalizacao = null } = {}) {
  const fila = itens.map((item, idx) => ({
    status: 1,
    id_condominio: 1,
    id_usuario_criacao: null,
    mensagem_tratada_ia: null,
    modulo: null,
    assunto: null,
    falha: null,
    data_cron_execucao: null,
    created_at: new Date(2026, 0, 1, 0, 0, idx),
    updated_at: new Date(),
    ...item
  }));
  const enviados = [];

  // Reserva: no JS cada handler é atômico, como o UPDATE ... SKIP LOCKED.
  on(/SET status = 4/, () => {
    const livre = fila
      .filter((l) => l.status === 1)
      .sort((a, b) => a.created_at - b.created_at || a.id - b.id)[0];
    if (!livre) return [];
    livre.status = 4;
    livre.updated_at = new Date();
    return [{ ...livre }];
  });
  on(/SET status = :status/, (r) => {
    if (falharFinalizacao && falharFinalizacao(r)) throw new Error('conexão perdida com o banco');
    const linha = fila.find((l) => l.id === r.id && l.status === 4);
    if (linha) Object.assign(linha, { status: r.status, falha: r.falha, data_cron_execucao: new Date() });
    return [[], linha ? 1 : 0];
  });
  on(/SET mensagem_tratada_ia/, (r) => {
    const linha = fila.find((l) => l.id === r.id && l.status === 4);
    if (linha) linha.mensagem_tratada_ia = r.mensagem_tratada_ia;
    return [[], linha ? 1 : 0];
  });
  on(/SELECT count\(\*\) AS total[\s\S]*status = 4/, () => [{
    total: fila.filter((l) => l.status === 4 && l.updated_at < Date.now() - 15 * 60 * 1000).length
  }]);
  on(/SELECT telefone, email, chat_id_telegram/, (r) => usuarios.filter(
    (u) => u.id === r.id && u.id_condominio === r.id_condominio
  ));
  on(/tb_sgw_perfil/, () => []);
  on(/FROM "condominio-bh"\."tb-condominios" WHERE id = :id/, () => [{ nome: 'Condomínio Teste' }]);

  global.fetch = jest.fn(async (url, opcoes) => {
    enviados.push({ url: String(url), body: JSON.parse(opcoes.body) });
    return resposta(200, String(url).includes('telegram') ? { ok: true } : { success: true });
  });
  return { fila, enviados };
}

function resposta(status, corpo) {
  return { status, ok: status >= 200 && status < 300, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) };
}

const USUARIOS = [
  { id: 10, id_condominio: 1, telefone: '31999990000', email: 'morador@teste.local', chat_id_telegram: '555', nome: 'Ana' },
  { id: 20, id_condominio: 2, telefone: '31988880000', email: 'outro@teste.local', chat_id_telegram: '777', nome: 'Bia' }
];

const processar = () => request(app).post(ROTA).set('X-Cron-Queue-Key', CHAVE);

// ------------------------------------------------------------- autenticação
describe('guarda X-Cron-Queue-Key', () => {
  test('chave ausente → 401, sem tocar na fila', async () => {
    const res = await request(app).post(ROTA);
    expect(res.status).toBe(401);
    expect(callsMatching(/tb_mensagens_fila/)).toHaveLength(0);
  });

  test('chave incorreta (mesmo tamanho e tamanho diferente) → 401', async () => {
    expect((await request(app).post(ROTA).set('X-Cron-Queue-Key', CHAVE.replace(/.$/, 'X'))).status).toBe(401);
    expect((await request(app).post(ROTA).set('X-Cron-Queue-Key', 'curta')).status).toBe(401);
    expect(callsMatching(/tb_mensagens_fila/)).toHaveLength(0);
  });

  test('CRON_QUEUE_KEY não configurada → 401 até com header (fail closed)', async () => {
    delete process.env.CRON_QUEUE_KEY;
    expect((await request(app).post(ROTA).set('X-Cron-Queue-Key', CHAVE)).status).toBe(401);
    expect((await request(app).post(ROTA).set('X-Cron-Queue-Key', '')).status).toBe(401);
  });

  test('acima de 20 tentativas inválidas → 429; chave nunca aparece no log', async () => {
    const status = [];
    for (let i = 0; i < 21; i += 1) {
      status.push((await request(app).post(ROTA).set('X-Cron-Queue-Key', 'chave-errada-secreta')).status);
    }
    expect(status.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(status[20]).toBe(429);
    const logs = JSON.stringify(console.warn.mock.calls) + JSON.stringify(console.error.mock.calls);
    expect(logs).not.toContain('chave-errada-secreta');
  });

  test('rate limit indisponível continua negando com 401', async () => {
    on(/tb_rate_limit/, () => { throw new Error('relation does not exist'); });
    expect((await request(app).post(ROTA).set('X-Cron-Queue-Key', 'x')).status).toBe(401);
  });

  test('chave válida não consulta o rate limit', async () => {
    instalarFila();
    expect((await processar()).status).toBe(200);
    expect(callsMatching(/tb_rate_limit/)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- reserva
describe('reserva atômica e status terminais', () => {
  test('duas execuções concorrentes: cada mensagem é enviada uma única vez', async () => {
    const { fila, enviados } = instalarFila({
      itens: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, tipo: 'telegram', id_usuario_destino: 10, mensagem_tratada_ia: 'oi' })),
      usuarios: USUARIOS
    });
    const fetchBase = global.fetch;
    global.fetch = jest.fn(async (...args) => {
      await new Promise((r) => setTimeout(r, 5)); // força intercalação
      return fetchBase(...args);
    });

    const [a, b] = await Promise.all([processar(), processar()]);
    expect(a.body.sucesso + b.body.sucesso).toBe(6);
    expect(enviados).toHaveLength(6);
    expect(fila.every((l) => l.status === 2)).toBe(true);
  });

  test('status 2, 3, 4 e 5 nunca são reprocessados', async () => {
    const { fila, enviados } = instalarFila({
      itens: [
        { id: 1, tipo: 'telegram', id_usuario_destino: 10, status: 2 },
        { id: 2, tipo: 'telegram', id_usuario_destino: 10, status: 3, falha: 'X' },
        { id: 3, tipo: 'telegram', id_usuario_destino: 10, status: 4 },
        { id: 4, tipo: 'telegram', id_usuario_destino: 10, status: 5 }
      ],
      usuarios: USUARIOS
    });
    const res = await processar();
    expect(res.body).toMatchObject({ processadas: 0 });
    expect(enviados).toHaveLength(0);
    expect(fila.map((l) => l.status)).toEqual([2, 3, 4, 5]);
    expect(fila[1].falha).toBe('X');
  });

  test('limite de 50 por execução', async () => {
    const { fila } = instalarFila({
      itens: Array.from({ length: 55 }, (_, i) => ({ id: i + 1, tipo: 'telegram', id_usuario_destino: 10, mensagem_tratada_ia: 'oi' })),
      usuarios: USUARIOS
    });
    const res = await processar();
    expect(res.body.processadas).toBe(50);
    expect(fila.filter((l) => l.status === 1)).toHaveLength(5);
  });

  test('item preso em 4 (execução interrompida) não volta a 1 e é contado como preso', async () => {
    const { fila, enviados } = instalarFila({
      itens: [{ id: 1, tipo: 'telegram', id_usuario_destino: 10, status: 4, updated_at: new Date(Date.now() - 60 * 60 * 1000) }],
      usuarios: USUARIOS
    });
    const res = await processar();
    expect(res.body.presas_em_processamento).toBe(1);
    expect(fila[0].status).toBe(4);
    expect(enviados).toHaveLength(0);
  });

  test('orçamento de tempo: para de reservar e deixa o resto pendente (1)', async () => {
    process.env.FILA_TEMPO_MAX_MS = '1000';
    const { fila } = instalarFila({
      itens: [1, 2, 3].map((id) => ({ id, tipo: 'telegram', id_usuario_destino: 10, mensagem_tratada_ia: 'oi' })),
      usuarios: USUARIOS
    });
    global.fetch = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 1100));
      return resposta(200, { ok: true });
    });
    const res = await processar();
    expect(res.body.processadas).toBe(1);
    expect(fila.map((l) => l.status)).toEqual([2, 1, 1]);
  });
});

// ----------------------------------------------------------- desfechos
describe('desfecho do envio', () => {
  const umTelegram = () => instalarFila({
    itens: [{ id: 1, tipo: 'telegram', id_usuario_destino: 10, mensagem_tratada_ia: 'oi' }],
    usuarios: USUARIOS
  });

  test.each([
    [400, { ok: false, description: 'Bad Request: chat not found' }, 3],
    [403, { ok: false, description: 'Forbidden: bot was blocked by the user' }, 3],
    [500, { ok: false }, 3],
    [503, { ok: false }, 3],
    [200, { ok: false, description: 'rejeitado' }, 3],
    [502, 'Bad Gateway', 5],
    [504, 'Gateway Timeout', 5],
    [200, 'corpo-ilegivel', 5]
  ])('HTTP %s %j → status %s, uma única tentativa', async (http, corpo, esperado) => {
    const { fila } = umTelegram();
    global.fetch = jest.fn(async () => resposta(http, corpo));
    const res = await processar();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fila[0].status).toBe(esperado);
    expect(fila[0].falha).toMatch(new RegExp(`^TELEGRAM_${esperado === 5 ? 'INDETERMINADO' : 'REJEITADO'}:HTTP_${http}`));
    expect(res.body[esperado === 5 ? 'indeterminadas' : 'falha']).toBe(1);
  });

  test('timeout/erro de rede → 5 (indeterminado), sem retry, sem vazar o token do bot', async () => {
    const { fila } = umTelegram();
    global.fetch = jest.fn(async (url) => {
      const erro = new Error(`network timeout at: ${url}`);
      erro.type = 'request-timeout';
      throw erro;
    });
    await processar();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fila[0].status).toBe(5);
    expect(fila[0].falha).toBe('TELEGRAM_INDETERMINADO:request-timeout');
    const logs = JSON.stringify([console.log.mock.calls, console.warn.mock.calls, console.error.mock.calls]);
    expect(logs).not.toContain(TOKEN_BOT);
    expect(JSON.stringify(fila)).not.toContain(TOKEN_BOT);
  });

  test('aceito, mas UPDATE do status 2 falha → 5 e não reenvia na execução seguinte', async () => {
    const { fila, enviados } = instalarFila({
      itens: [{ id: 1, tipo: 'telegram', id_usuario_destino: 10, mensagem_tratada_ia: 'oi' }],
      usuarios: USUARIOS,
      falharFinalizacao: (r) => r.status === 2
    });
    const res = await processar();
    expect(res.status).toBe(200);
    expect(fila[0].status).toBe(5);
    expect(fila[0].falha).toBe('ACEITO_SEM_CONFIRMACAO_DB');
    await processar();
    expect(enviados).toHaveLength(1);
  });

  test('aceito e banco totalmente fora na finalização → fica em 4, lote continua, sem reenvio', async () => {
    const { fila, enviados } = instalarFila({
      itens: [1, 2].map((id) => ({ id, tipo: 'telegram', id_usuario_destino: 10, mensagem_tratada_ia: 'oi' })),
      usuarios: USUARIOS,
      falharFinalizacao: (r) => r.id === 1
    });
    const res = await processar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ processadas: 2, sucesso: 1, indeterminadas: 1 });
    expect(fila.map((l) => l.status)).toEqual([4, 2]);
    await processar();
    expect(enviados).toHaveLength(2);
  });

  test('erro de banco antes do envio → 3, sem envio', async () => {
    const { fila, enviados } = umTelegram();
    on(/SELECT telefone, email, chat_id_telegram/, () => { throw new Error('timeout ao consultar usuarios'); });
    await processar();
    expect(enviados).toHaveLength(0);
    expect(fila[0].status).toBe(3);
    expect(fila[0].falha).toMatch(/^ERRO_PREPARACAO/);
  });

  test('Telegram sem token → 3 (TELEGRAM_NAO_CONFIGURADO), sem fetch', async () => {
    const { fila } = umTelegram();
    delete process.env.TELEGRAM_BOT_TOKEN;
    await processar();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fila[0]).toMatchObject({ status: 3, falha: 'TELEGRAM_NAO_CONFIGURADO' });
  });

  test('e-mail usa enviarEmailFila e respeita o resultado (rejeitado → 3)', async () => {
    const { fila } = instalarFila({
      itens: [{ id: 1, tipo: 'email', id_usuario_destino: 10, assunto: 'A' }],
      usuarios: USUARIOS
    });
    emailService.enviarEmailFila.mockImplementation(async () => ({ resultado: 'rejeitado', http_status: 422, codigo: 'EMAIL_REJEITADO:HTTP_422' }));
    await processar();
    expect(emailService.enviarEmailFila).toHaveBeenCalledTimes(1);
    expect(fila[0]).toMatchObject({ status: 3, falha: 'EMAIL_REJEITADO:HTTP_422' });
  });

  test('resposta 500 do endpoint não traz detail', async () => {
    on(/SET status = 4/, () => { throw new Error('relation "tb_mensagens_fila" does not exist'); });
    const res = await processar();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: 'Falha ao processar fila de mensagens.' });
  });
});

// --------------------------------------------------------------- WhatsApp
describe('WhatsApp (WHATSAPP_ENABLED)', () => {
  const itemWhatsapp = () => instalarFila({
    itens: [{ id: 1, tipo: 'whatsapp', id_usuario_destino: 10, mensagem_bruta: 'oi' }],
    usuarios: USUARIOS
  });

  test('desativado por padrão: processamento marca 3, sem fetch', async () => {
    const { fila } = itemWhatsapp();
    await processar();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fila[0]).toMatchObject({ status: 3, falha: 'WHATSAPP_DESATIVADO' });
  });

  test('ativado sem URL → 3 (WHATSAPP_NAO_CONFIGURADO), sem fetch', async () => {
    process.env.WHATSAPP_ENABLED = 'true';
    delete process.env.WHATSAPP_DISPATCH_URL;
    const { fila } = itemWhatsapp();
    await processar();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fila[0]).toMatchObject({ status: 3, falha: 'WHATSAPP_NAO_CONFIGURADO' });
  });

  test('ativado e configurado: 4xx → 3; 200 success → 2; envia X-Idempotency-Key', async () => {
    process.env.WHATSAPP_ENABLED = 'true';
    const { fila } = itemWhatsapp();
    global.fetch = jest.fn(async () => resposta(401, { success: false, message: 'chave inválida' }));
    await processar();
    expect(fila[0]).toMatchObject({ status: 3 });
    expect(fila[0].falha).toMatch(/^WHATSAPP_REJEITADO:HTTP_401/);

    const segundo = itemWhatsapp();
    await processar();
    expect(segundo.fila[0].status).toBe(2);
    expect(global.fetch.mock.calls[0][1].headers['X-Idempotency-Key']).toBe('fila_1');
  });

  test('desativado: enfileiramento individual → 422', async () => {
    const token = sessao({ id: 10, perfil: PERFIL.SINDICO, condominio: 1 });
    const res = await request(app).post('/api/condominio/mensagens/fila')
      .set('Authorization', `Bearer ${token}`)
      .send({ id_usuario_destino: 10, tipo: 'whatsapp', mensagem_bruta: 'oi' });
    expect(res.status).toBe(422);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_mensagens_fila/)).toHaveLength(0);
  });

  test('desativado: lote ignora WhatsApp e enfileira os demais canais', async () => {
    on(/mensagem_whatsapp, mensagem_telegram/, () => [
      { id: 10, email: 'morador@teste.local', telefone: '31999990000', chat_id_telegram: '555', mensagem_whatsapp: true, mensagem_telegram: true }
    ]);
    const token = sessao({ id: 1, perfil: PERFIL.SINDICO, condominio: 1 });
    const res = await request(app).post('/api/condominio/mensagens/fila/lote')
      .set('Authorization', `Bearer ${token}`)
      .send({ perfil_ids: [2], tipos: ['whatsapp', 'telegram'], mensagem_bruta: 'oi' });
    expect(res.status).toBe(201);
    expect(res.body.enfileiradas).toBe(1);
    expect(res.body.ignoradas.whatsapp_canal_desativado).toBe(1);
    const insert = callsMatching(/INSERT INTO "condominio-bh"\.tb_mensagens_fila/)[0];
    expect(Object.values(insert.replacements)).not.toContain('whatsapp');
  });
});

// ------------------------------------------------------------- isolamento
describe('isolamento entre condomínios', () => {
  test('destinatário de outro condomínio → 3, sem envio', async () => {
    const { fila, enviados } = instalarFila({
      itens: [{ id: 1, tipo: 'telegram', id_condominio: 1, id_usuario_destino: 20, mensagem_tratada_ia: 'oi' }],
      usuarios: USUARIOS
    });
    await processar();
    expect(enviados).toHaveLength(0);
    expect(fila[0]).toMatchObject({ status: 3, falha: 'DESTINATARIO_NAO_ENCONTRADO_NO_CONDOMINIO' });
    const consulta = callsMatching(/SELECT telefone, email, chat_id_telegram/)[0];
    expect(consulta.replacements).toEqual({ id: 20, id_condominio: 1 });
  });
});

// ------------------------------------------------------- serviço de e-mail
describe('enviarEmailFila (serviço real, fetch mockado)', () => {
  const { enviarEmailFila } = jest.requireActual('../src/service/emailDispatchService');

  beforeEach(() => { process.env.EMAIL_DISPATCH_URL = 'https://email.teste.local/dispatch'; });

  test.each([
    [200, { success: true }, 'aceito'],
    [200, { success: false, message: 'template inexistente' }, 'rejeitado'],
    [422, { success: false }, 'rejeitado'],
    [500, { success: false }, 'rejeitado'],
    [504, 'x', 'indeterminado']
  ])('HTTP %s %j → %s, uma tentativa', async (http, corpo, esperado) => {
    global.fetch = jest.fn(async () => resposta(http, corpo));
    const r = await enviarEmailFila({ _ref: 'fila_9', emails: ['a@b.c'] });
    expect(r.resultado).toBe(esperado);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('sem configuração → nao_configurado, sem fetch', async () => {
    delete process.env.EMAIL_DISPATCH_URL;
    const r = await enviarEmailFila({ _ref: 'fila_9' });
    expect(r.resultado).toBe('nao_configurado');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
