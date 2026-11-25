'use strict';

// Concorrência REAL do rate limit contra um PostgreSQL isolado e descartável.
// Só roda com TEST_PG_URL (ex.: cluster temporário local criado com initdb).
// NUNCA aponte para o banco de produção: o teste cria e apaga o schema.
//
//   TEST_PG_URL=postgres://postgres@127.0.0.1:55432/postgres npx jest --runInBand tests/pg

const { Pool } = require('pg');
const { consumir, devolver, cooldown, limparRateLimit } = require('../../src/helpers/rateLimit');
const migration = require('../../src/database/migrations/20261125000001-tb-rate-limit');

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;

// Converte replacements nomeados (:nome) do Sequelize em parâmetros $n.
function criarExecutor(pool) {
  return async (sql, replacements = {}) => {
    const valores = [];
    const indices = new Map();
    const texto = sql.replace(/(?<!:):([a-z_]+)/g, (_m, nome) => {
      if (!indices.has(nome)) {
        valores.push(replacements[nome]);
        indices.set(nome, valores.length);
      }
      return `$${indices.get(nome)}`;
    });
    const resultado = await pool.query(texto, valores);
    return resultado.rows;
  };
}

descrever('rateLimit em PostgreSQL real (concorrência)', () => {
  let pool;
  let executor;

  beforeAll(async () => {
    if (/neon\.tech|amazonaws|vercel|prod/i.test(URL_PG)) {
      throw new Error('TEST_PG_URL parece apontar para um banco remoto/produção. Abortado.');
    }
    pool = new Pool({ connectionString: URL_PG, max: 30 });
    await pool.query('DROP SCHEMA IF EXISTS "condominio-bh" CASCADE');
    await pool.query('CREATE SCHEMA "condominio-bh"');
    await migration.up({ sequelize: { query: (sql) => pool.query(sql) } });
    executor = criarExecutor(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DROP SCHEMA IF EXISTS "condominio-bh" CASCADE');
      await pool.end();
    }
  });

  test('50 consumos paralelos com limite 10: exatamente 10 permitidos, contador 50', async () => {
    const resultados = await Promise.all(Array.from({ length: 50 }, () => consumir('pg:teste:limite', 10, 3600, { executor })));
    expect(resultados.filter((r) => r.permitido)).toHaveLength(10);
    const contadores = resultados.map((r) => r.contador).sort((a, b) => a - b);
    expect(contadores).toEqual(Array.from({ length: 50 }, (_, i) => i + 1)); // sem duplicatas: atômico
  });

  test('cooldown: 20 chamadas paralelas → só 1 liberada', async () => {
    const resultados = await Promise.all(Array.from({ length: 20 }, () => cooldown('pg:teste:cooldown', 60, { executor })));
    expect(resultados.filter((r) => r.permitido)).toHaveLength(1);
  });

  test('devolver usa a janela original e nunca fica negativo', async () => {
    const reserva = await consumir('pg:teste:devolver', 5, 3600, { executor });
    await Promise.all(Array.from({ length: 5 }, () => devolver(reserva, { executor })));
    const [linha] = await executor('SELECT contador FROM "condominio-bh".tb_rate_limit WHERE chave = :chave AND janela = :janela', reserva);
    expect(Number(linha.contador)).toBe(0);
    // Uma janela diferente (ex.: hora seguinte) não é afetada.
    await executor(`INSERT INTO "condominio-bh".tb_rate_limit (chave, janela, contador, atualizado_em)
                    VALUES (:chave, :janela, 3, now())`, { chave: reserva.chave, janela: new Date(new Date(reserva.janela).getTime() + 3600 * 1000) });
    await devolver(reserva, { executor });
    const linhas = await executor('SELECT contador FROM "condominio-bh".tb_rate_limit WHERE chave = :chave ORDER BY janela', { chave: reserva.chave });
    expect(linhas.map((l) => Number(l.contador))).toEqual([0, 3]);
  });

  test('CHECK impede contador negativo no banco', async () => {
    await expect(executor(`INSERT INTO "condominio-bh".tb_rate_limit (chave, janela, contador) VALUES ('pg-neg', now(), -1)`))
      .rejects.toThrow(/check/i);
  });

  test('limpeza remove só o que tem mais de 48 h', async () => {
    await executor(`INSERT INTO "condominio-bh".tb_rate_limit (chave, janela, contador, atualizado_em)
                    VALUES ('pg-velho', now() - interval '3 days', 1, now() - interval '3 days'),
                           ('pg-novo', now(), 1, now())`);
    const apagadas = await limparRateLimit({ executor });
    expect(apagadas).toBeGreaterThanOrEqual(1);
    const restantes = await executor(`SELECT chave FROM "condominio-bh".tb_rate_limit WHERE chave IN ('pg-velho', 'pg-novo')`);
    expect(restantes.map((r) => r.chave)).toEqual(['pg-novo']);
  });
});
