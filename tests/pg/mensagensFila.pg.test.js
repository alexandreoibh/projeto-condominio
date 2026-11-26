'use strict';

// Reserva atômica REAL da fila de mensagens contra um PostgreSQL isolado e
// descartável (TEST_PG_URL). O controller roda normalmente; o banco simulado
// delega ao Sequelize real. Envios mockados (fetch): nada sai para a rede.
// NUNCA aponte para produção: o teste cria e apaga o schema "condominio-bh".
//
//   TEST_PG_URL=postgres://postgres@127.0.0.1:55432/postgres npx jest --runInBand tests/pg

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;

const DDL = `
  CREATE TABLE "condominio-bh"."tb-usuarios" (
    id INTEGER PRIMARY KEY, id_condominio INTEGER, nome TEXT, sobrenome TEXT, email TEXT, telefone TEXT,
    chat_id_telegram TEXT, apartamento TEXT, bloco TEXT, tipo_perfil_id INTEGER, status TEXT
  );
  CREATE TABLE "condominio-bh"."tb-condominios" (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE "condominio-bh".tb_sgw_perfil (id INTEGER PRIMARY KEY, nome TEXT);
  INSERT INTO "condominio-bh"."tb-condominios" VALUES (1, 'Cond A'), (2, 'Cond B');
  INSERT INTO "condominio-bh"."tb-usuarios" (id, id_condominio, nome, chat_id_telegram, status)
       VALUES (10, 1, 'Ana', '555', 'ativo'), (20, 2, 'Bia', '777', 'ativo');
`;

function criarRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(corpo) { this.body = corpo; return this; }
  };
}

descrever('Fila de mensagens em PostgreSQL real (concorrência)', () => {
  let sequelize;
  let controller;
  const linhas = (sql) => sequelize.query(sql, { type: 'SELECT' });

  beforeAll(async () => {
    if (/neon\.tech|amazonaws|vercel|prod/i.test(URL_PG)) {
      throw new Error('TEST_PG_URL parece apontar para um banco remoto/produção. Abortado.');
    }
    const { Sequelize } = jest.requireActual('sequelize');
    sequelize = new Sequelize(URL_PG, { dialect: 'postgres', logging: false, pool: { max: 20 } });
    await sequelize.query('DROP SCHEMA IF EXISTS "condominio-bh" CASCADE');
    await sequelize.query('CREATE SCHEMA "condominio-bh"');
    await require('../../src/database/migrations/20260803233134-create-tb-mensagens-fila').up({ sequelize });
    await require('../../src/database/migrations/20260930000002-alter-tb-mensagens-fila-add-email').up({ sequelize });
    await sequelize.query(DDL);

    require('../helpers/fakeDb')._fake.delegarPara(sequelize);
    const CondominioController = require('../../src/controllers/condominioController');
    controller = new CondominioController();
  });

  afterAll(async () => {
    require('../helpers/fakeDb')._fake.delegarPara(null);
    if (sequelize) {
      await sequelize.query('DROP SCHEMA IF EXISTS "condominio-bh" CASCADE');
      await sequelize.close();
    }
  });

  beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123:token-de-teste';
    await sequelize.query('TRUNCATE "condominio-bh".tb_mensagens_fila RESTART IDENTITY');
  });

  test('5 execuções paralelas: cada mensagem enviada exatamente uma vez; 2 e 3 intactos', async () => {
    // 40 pendentes do condomínio 1, mais histórico (2 e 3) que não pode mudar.
    await sequelize.query(`
      INSERT INTO "condominio-bh".tb_mensagens_fila (id_condominio, id_usuario_destino, tipo, mensagem_bruta, mensagem_tratada_ia, status)
      SELECT 1, 10, 'telegram', 'x', 'msg-' || g, 1 FROM generate_series(1, 40) g;
      INSERT INTO "condominio-bh".tb_mensagens_fila (id_condominio, id_usuario_destino, tipo, mensagem_bruta, mensagem_tratada_ia, status, falha, data_cron_execucao)
      VALUES (1, 10, 'telegram', 'x', 'hist-2', 2, NULL, '2026-11-01'), (1, 10, 'telegram', 'x', 'hist-3', 3, 'antiga', '2026-11-01');
    `);

    const enviados = [];
    global.fetch = jest.fn(async (url, opcoes) => {
      enviados.push(JSON.parse(opcoes.body).text);
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8)));
      return { status: 200, ok: true, text: async () => '{"ok":true}' };
    });

    const respostas = Array.from({ length: 5 }, criarRes);
    await Promise.all(respostas.map((res) => controller.processarFilaMensagens({}, res)));

    expect(respostas.every((r) => r.statusCode === 200)).toBe(true);
    expect(respostas.reduce((t, r) => t + r.body.sucesso, 0)).toBe(40);
    expect(enviados).toHaveLength(40);
    expect(new Set(enviados).size).toBe(40);
    expect(enviados).not.toContain('hist-2');
    expect(enviados).not.toContain('hist-3');

    const porStatus = await linhas(
      `SELECT status, count(*)::int AS n FROM "condominio-bh".tb_mensagens_fila GROUP BY status ORDER BY status`
    );
    expect(porStatus).toEqual([{ status: 2, n: 41 }, { status: 3, n: 1 }]);
    const [hist3] = await linhas(`SELECT falha FROM "condominio-bh".tb_mensagens_fila WHERE mensagem_tratada_ia = 'hist-3'`);
    expect(hist3.falha).toBe('antiga');
  });

  test('item reservado (4) por uma execução em andamento não é pego por outra', async () => {
    await sequelize.query(`
      INSERT INTO "condominio-bh".tb_mensagens_fila (id_condominio, id_usuario_destino, tipo, mensagem_bruta, mensagem_tratada_ia, status)
      VALUES (1, 10, 'telegram', 'x', 'unica', 1);
    `);
    let liberar;
    const bloqueio = new Promise((r) => { liberar = r; });
    global.fetch = jest.fn(async () => {
      await bloqueio; // primeira execução fica "presa" no envio
      return { status: 200, ok: true, text: async () => '{"ok":true}' };
    });

    const resA = criarRes();
    const execA = controller.processarFilaMensagens({}, resA);
    await new Promise((r) => setTimeout(r, 200));
    const [{ status }] = await linhas(`SELECT status FROM "condominio-bh".tb_mensagens_fila`);
    expect(status).toBe(4);

    const resB = criarRes();
    await controller.processarFilaMensagens({}, resB);
    expect(resB.body.processadas).toBe(0);

    liberar();
    await execA;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(resA.body.sucesso).toBe(1);
  });

  test('isolamento: item do condomínio 1 para usuário do condomínio 2 → 3, sem envio', async () => {
    await sequelize.query(`
      INSERT INTO "condominio-bh".tb_mensagens_fila (id_condominio, id_usuario_destino, tipo, mensagem_bruta, status)
      VALUES (1, 20, 'telegram', 'x', 1);
    `);
    global.fetch = jest.fn();
    const res = criarRes();
    await controller.processarFilaMensagens({}, res);
    expect(global.fetch).not.toHaveBeenCalled();
    const [linha] = await linhas(`SELECT status, falha FROM "condominio-bh".tb_mensagens_fila`);
    expect(linha).toEqual({ status: 3, falha: 'DESTINATARIO_NAO_ENCONTRADO_NO_CONDOMINIO' });
  });
});
