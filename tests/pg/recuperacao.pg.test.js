'use strict';

// Atomicidade REAL da emissão e do consumo de desafios/tokens de recuperação,
// contra um PostgreSQL isolado e descartável (TEST_PG_URL). Carrega o
// controller normalmente; o banco simulado delega ao Sequelize real.
// NUNCA aponte para produção: o teste cria e apaga o schema "condominio-bh".

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;

const DDL = `
  CREATE SCHEMA "condominio-bh";
  CREATE TABLE "condominio-bh".tb_recovery_tokens (
    id SERIAL PRIMARY KEY,
    id_usuario INTEGER NOT NULL,
    id_condominio INTEGER,
    code_hash VARCHAR(255) NOT NULL,
    invite_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    reset_token_hash VARCHAR(64),
    reset_expires_at TIMESTAMPTZ,
    reset_used_at TIMESTAMPTZ,
    request_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE "condominio-bh".tb_auditoria_seguranca (
    id SERIAL PRIMARY KEY, id_usuario_ator INTEGER, id_condominio INTEGER, acao VARCHAR(80) NOT NULL,
    entidade VARCHAR(80), entidade_id VARCHAR(80), detalhes TEXT, ip VARCHAR(64), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE "condominio-bh"."tb-usuarios" (
    id INTEGER PRIMARY KEY, id_condominio INTEGER, nome TEXT, sobrenome TEXT, email TEXT, cpf TEXT,
    status TEXT, senha_hash TEXT, token_version INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ
  );
  CREATE TABLE "condominio-bh"."tb-condominios" (id INTEGER PRIMARY KEY, ativo BOOLEAN);
  INSERT INTO "condominio-bh"."tb-condominios" VALUES (1, true);
  INSERT INTO "condominio-bh"."tb-usuarios" (id, id_condominio, nome, email, cpf, status, senha_hash)
       VALUES (10, 1, 'Vitima', 'vitima@teste.local', '52998224725', 'ativo', NULL);
`;

descrever('Recuperação em PostgreSQL real (concorrência)', () => {
  let sequelize;
  let controller;
  let despacharEmail;
  const USUARIO = { id: 10, id_condominio: 1, nome: 'Vitima', sobrenome: '', email: 'vitima@teste.local' };

  const linhas = async (sql) => sequelize.query(sql, { type: 'SELECT' });

  beforeAll(async () => {
    if (/neon\.tech|amazonaws|vercel|prod/i.test(URL_PG)) {
      throw new Error('TEST_PG_URL parece apontar para um banco remoto/produção. Abortado.');
    }
    const { Sequelize } = jest.requireActual('sequelize');
    sequelize = new Sequelize(URL_PG, { dialect: 'postgres', logging: false, pool: { max: 20 } });
    await sequelize.query('DROP SCHEMA IF EXISTS "condominio-bh" CASCADE');
    await sequelize.query(DDL);
    const migration = require('../../src/database/migrations/20261125000001-tb-rate-limit');
    await migration.up({ sequelize });

    // O módulo de banco é o fakeDb (mock global); aqui ele delega ao Sequelize real.
    require('../helpers/fakeDb')._fake.delegarPara(sequelize);
    const CondominioController = require('../../src/controllers/condominioController');
    ({ despacharEmail } = require('../../src/service/emailDispatchService'));
    controller = new CondominioController();
  });

  afterAll(async () => {
    require('../helpers/fakeDb')._fake.delegarPara(null);
    if (sequelize) {
      await sequelize.query('DROP SCHEMA IF EXISTS "condominio-bh" CASCADE');
      await sequelize.close();
    }
  });

  test('10 emissões paralelas para a mesma conta → exatamente 1 desafio pendente', async () => {
    await Promise.all(Array.from({ length: 10 }, () => controller._criarDesafioRecuperacao({ usuario: USUARIO, ip: '127.0.0.1' })));
    const [{ pendentes, total }] = await linhas(
      `SELECT count(*) FILTER (WHERE consumed_at IS NULL)::int AS pendentes, count(*)::int AS total
         FROM "condominio-bh".tb_recovery_tokens WHERE id_usuario = 10`
    );
    expect(total).toBe(10);
    expect(pendentes).toBe(1);
  });

  test('10 verificações paralelas com o código certo → exatamente 1 reset token', async () => {
    despacharEmail.mockClear();
    await controller._criarDesafioRecuperacao({ usuario: USUARIO, ip: '127.0.0.1' });
    await global.aguardarPendentes();
    const codigo = despacharEmail.mock.calls[despacharEmail.mock.calls.length - 1][0].token;

    const resultados = await Promise.all(Array.from({ length: 10 }, () =>
      controller._validarCodigoEEmitirResetTokenInterno({ idUsuario: 10, code: codigo })));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    const [{ tokens }] = await linhas(
      `SELECT count(*)::int AS tokens FROM "condominio-bh".tb_recovery_tokens
        WHERE id_usuario = 10 AND reset_token_hash IS NOT NULL`
    );
    expect(tokens).toBe(1);
  });

  test('5 resets paralelos com o mesmo token → exatamente 1 troca de senha e token_version +1', async () => {
    despacharEmail.mockClear();
    await sequelize.query(`UPDATE "condominio-bh".tb_recovery_tokens SET consumed_at = NOW(), reset_used_at = NOW() WHERE id_usuario = 10`);
    await controller._criarDesafioRecuperacao({ usuario: USUARIO, ip: '127.0.0.1' });
    await global.aguardarPendentes();
    const codigo = despacharEmail.mock.calls[despacharEmail.mock.calls.length - 1][0].token;
    const { resetToken } = await controller._validarCodigoEEmitirResetTokenInterno({ idUsuario: 10, code: codigo });
    const [{ token_version: antes }] = await linhas(`SELECT token_version FROM "condominio-bh"."tb-usuarios" WHERE id = 10`);

    const chamarReset = () => new Promise((resolve) => {
      const req = {
        body: { user_id: 10, reset_token: resetToken, password: 'Senha-Forte-2026!' },
        headers: {},
        ip: '127.0.0.1',
        socket: {}
      };
      const res = {
        statusCode: 200,
        status(codigoHttp) { this.statusCode = codigoHttp; return this; },
        json(corpo) { resolve({ status: this.statusCode, corpo }); return this; }
      };
      controller.recoveryReset(req, res);
    });
    const respostas = await Promise.all(Array.from({ length: 5 }, chamarReset));
    expect(respostas.filter((r) => r.status === 200)).toHaveLength(1);
    expect(respostas.filter((r) => r.status === 401)).toHaveLength(4);
    const [usuario] = await linhas(`SELECT token_version, left(senha_hash, 4) AS prefixo FROM "condominio-bh"."tb-usuarios" WHERE id = 10`);
    expect(usuario.token_version).toBe(antes + 1);
    expect(usuario.prefixo).toMatch(/^\$2[aby]\$/);
  });
});
