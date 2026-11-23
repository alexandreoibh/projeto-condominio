'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { signImageAccessToken } = require('../src/helpers/auth');
const { sessao, convite, PERFIL } = require('./helpers/tokens');

const { on, callsMatching } = fakeDb._fake;
const ROTA = '/api/condominio/perfis';

beforeEach(() => {
  on(/FROM "condominio-bh"\.tb_sgw_perfil/, () => []);
});

describe('Middleware auth (JWT de sessão)', () => {
  test('token válido passa', async () => {
    const res = await request(app).get(ROTA).set('Authorization', `Bearer ${sessao({ perfil: PERFIL.SINDICO })}`);
    expect(res.status).not.toBe(401);
  });

  test('sem token → 401', async () => {
    expect((await request(app).get(ROTA)).status).toBe(401);
  });

  test('assinatura adulterada → 401', async () => {
    const token = sessao();
    const [h, p] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.IdPerfil = 1;
    const forjado = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${token.split('.')[2]}`;
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${forjado}`)).status).toBe(401);
  });

  test('assinado com outro segredo (ex.: o antigo fallback fixo) → 401', async () => {
    fakeDb._fake.setUsuarioSessao(10);
    const token = jwt.sign({ id: 10, IdPerfil: 1, id_condominio: 1 }, 'dev_jwt_secret_change_me');
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('alg none → 401', async () => {
    fakeDb._fake.setUsuarioSessao(10);
    const semAssinatura = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ id: 10, IdPerfil: 1 })).toString('base64url')}.`;
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${semAssinatura}x`)).status).toBe(401);
  });

  test('expirado → 401', async () => {
    const token = sessao({ expiresIn: -10 });
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('token de imagem (avatar) não vale como sessão', async () => {
    fakeDb._fake.setUsuarioSessao(10);
    const token = signImageAccessToken({ tipo: 'avatar_usuario', id: 10, id_condominio: 1 });
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(app).get(`${ROTA}?token=${token}`)).status).toBe(401);
  });

  test('token de convite não vale como sessão', async () => {
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${convite()}`)).status).toBe(401);
  });

  test('token_version desatualizado (sessão revogada) → 401', async () => {
    const token = sessao({ id: 10, tv: 0 });
    fakeDb._fake.setUsuarioSessao(10, { token_version: 3 });
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('usuário inativado perde a sessão', async () => {
    const token = sessao({ id: 10 });
    fakeDb._fake.setUsuarioSessao(10, { status: 'inativo' });
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('logout revoga o token', async () => {
    const token = sessao({ id: 10 });
    const sair = await request(app).post('/api/login/logout').set('Authorization', `Bearer ${token}`);
    expect(sair.status).toBe(200);
    expect((await request(app).get(ROTA).set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});

describe('Login', () => {
  const SQL_LOGIN = /tu\.senha_hash,[\s\S]*FROM "condominio-bh"\."tb-usuarios" tu/;
  const SQL_RATE = /FROM "condominio-bh"\.tb_sgw_log_acesso\s+WHERE acao = 'LOGIN'/;

  test('mesma mensagem para usuário inexistente e senha errada', async () => {
    const hash = await bcrypt.hash('certa', 4);
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, (r) => (r.loginEmail === 'existe@teste.local'
      ? [{ id: 10, id_condominio: 1, email: 'existe@teste.local', senha_hash: hash, status: 'ativo', tipo_perfil_id: 2 }]
      : []));

    const inexistente = await request(app).post('/api/login').send({ login: 'nao@teste.local', password: 'x' });
    const senhaErrada = await request(app).post('/api/login').send({ login: 'existe@teste.local', password: 'errada' });
    expect(inexistente.body).toEqual(senhaErrada.body);
    expect(senhaErrada.body.check).toBe(false);
  });

  test('bloqueia após excesso de falhas (rate limit persistente) → 429', async () => {
    on(SQL_RATE, () => [{ falhas_login: 10, falhas_ip: 0 }]);
    const res = await request(app).post('/api/login').send({ login: 'existe@teste.local', password: 'x' });
    expect(res.status).toBe(429);
    expect(callsMatching(SQL_LOGIN)).toHaveLength(0);
  });

  test('IP enviado pelo navegador não substitui o IP observado no log', async () => {
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => []);
    await request(app).post('/api/login').set('X-Forwarded-For', '203.0.113.9').send({ login: 'a@teste.local', password: 'x', ip: '1.2.3.4' });
    const log = callsMatching(/INSERT INTO "condominio-bh"\.tb_sgw_log_acesso/)[0];
    expect(log.replacements.ip).toBe('203.0.113.9');
    expect(log.replacements.mensagem).toContain('ip_informado=1.2.3.4');
  });

  test('senha legada em texto puro é migrada para bcrypt e o JWT traz tv', async () => {
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => [{ id: 10, id_condominio: 1, email: 'a@teste.local', senha_hash: 'senha123', status: 'ativo', tipo_perfil_id: 2 }]);
    fakeDb._fake.setUsuarioSessao(10, { token_version: 4 });
    const res = await request(app).post('/api/login').send({ login: 'a@teste.local', password: 'senha123' });
    expect(res.body.check).toBe(true);
    expect(jwt.decode(res.body.token).tv).toBe(4);
    const migracao = callsMatching(/SET senha_hash = :senha_hash WHERE id = :id/)[0];
    expect(migracao.replacements.senha_hash).toMatch(/^\$2[aby]\$/);
  });
});
