'use strict';

// Incidente 24/11/2026: GET /planos/publicos foi removida e precisa responder 404.
// A X-Public-Registration-Key continua protegendo o cadastro por convite.

const request = require('supertest');

const CHAVE_TESTE = 'test-public-registration-key-0123456789';
process.env.PUBLIC_REGISTRATION_KEY = CHAVE_TESTE;

const app = require('../src/app');

describe('Rota pública de planos removida', () => {
  test.each([
    '/api/condominio/planos/publicos',
    '/service/planos/publicos'
  ])('GET %s com a chave válida → 404', async (rota) => {
    const res = await request(app).get(rota).set('X-Public-Registration-Key', CHAVE_TESTE);
    expect(res.status).toBe(404);
  });
});

describe('X-Public-Registration-Key no cadastro por convite', () => {
  const ROTA = '/api/condominio/usuarios/cadastro-por-convite';

  test('sem a chave → 401', async () => {
    expect((await request(app).post(ROTA).send({})).status).toBe(401);
  });

  test('chave errada → 401', async () => {
    const res = await request(app).post(ROTA).set('X-Public-Registration-Key', 'chave-antiga').send({});
    expect(res.status).toBe(401);
  });

  test('chave correta passa do guard (cai na validação)', async () => {
    const res = await request(app).post(ROTA).set('X-Public-Registration-Key', CHAVE_TESTE).send({});
    expect(res.status).toBe(422);
  });
});
