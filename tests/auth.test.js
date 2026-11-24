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

  test('bloqueia após excesso de falhas (rate limit persistente) → 429, sem conferir a senha', async () => {
    const hash = await bcrypt.hash('certa', 4);
    on(SQL_RATE, () => [{ falhas_login: 10, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => [{ id: 10, id_condominio: 1, email: 'existe@teste.local', senha_hash: hash, status: 'ativo', tipo_perfil_id: 2 }]);
    const res = await request(app).post('/api/login').send({ login: 'existe@teste.local', password: 'certa' });
    expect(res.status).toBe(429);
    expect(res.body.token).toBeUndefined();
  });

  test('rate limit por identidade normalizada: falhas contam pelo id_usuario (CPF e e-mail somam)', async () => {
    on(SQL_RATE, (r) => [{ falhas_login: r.id_usuario === 10 ? 10 : 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => [{ id: 10, id_condominio: 1, email: 'existe@teste.local', cpf: '52998224725', senha_hash: '$2a$04$x', status: 'ativo', tipo_perfil_id: 2 }]);
    const res = await request(app).post('/api/login').send({ login: '529.982.247-25', password: 'x' });
    expect(res.status).toBe(429);
    expect(callsMatching(SQL_RATE)[0].replacements.id_usuario).toBe(10);
  });

  test('falha ao consultar o rate limit recusa o login (fail closed) → 503', async () => {
    const hash = await bcrypt.hash('certa', 4);
    on(SQL_RATE, () => { throw new Error('db down'); });
    on(SQL_LOGIN, () => [{ id: 10, id_condominio: 1, email: 'existe@teste.local', senha_hash: hash, status: 'ativo', tipo_perfil_id: 2 }]);
    const res = await request(app).post('/api/login').send({ login: 'existe@teste.local', password: 'certa' });
    expect(res.status).toBe(503);
    expect(res.body.token).toBeUndefined();
  });

  test('e-mail sem dígitos não casa usuário com cpf vazio', async () => {
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => []);
    await request(app).post('/api/login').send({ login: 'semdigitos@teste.local', password: 'x' });
    expect(callsMatching(SQL_LOGIN)[0].replacements.loginCpf).toBe('');
    expect(callsMatching(SQL_LOGIN)[0].sql).toContain(":loginCpf <> ''");
  });

  test('dispositivo/SO/navegador declarados por cliente direto não vão para as colunas', async () => {
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => []);
    await request(app).post('/api/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')
      .send({ login: 'a@teste.local', password: 'x', dispositivo: 'x', sistema_operacional: 'x', navegador: 'x' });
    const log = callsMatching(/INSERT INTO "condominio-bh"\.tb_sgw_log_acesso/)[0];
    expect(log.replacements.dispositivo).toBe('desktop');
    expect(log.replacements.sistema_operacional).toBe('Windows');
    expect(log.replacements.navegador).toBe('Chrome');
    expect(log.replacements.mensagem).toContain('cliente_declarado=x/x/x');
  });

  test('IP enviado pelo navegador não substitui o IP observado no log', async () => {
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => []);
    await request(app).post('/api/login').set('X-Forwarded-For', '203.0.113.9').send({ login: 'a@teste.local', password: 'x', ip: '1.2.3.4' });
    const log = callsMatching(/INSERT INTO "condominio-bh"\.tb_sgw_log_acesso/)[0];
    expect(log.replacements.ip).toBe('203.0.113.9');
    expect(log.replacements.mensagem).toContain('ip_informado=1.2.3.4');
  });

  describe('proxy confiável (back-cond.php chamando em localhost)', () => {
    const logDoLogin = () => callsMatching(/INSERT INTO "condominio-bh"\.tb_sgw_log_acesso/)[0];
    const rateDoLogin = () => callsMatching(SQL_RATE)[0];

    beforeEach(() => {
      on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
      on(SQL_LOGIN, () => []);
    });

    test('loopback com X-Client-IP: limite e log usam o IP do cliente', async () => {
      await request(app).post('/api/login').set('X-Client-IP', '198.51.100.7').send({ login: 'a@teste.local', password: 'x' });
      expect(rateDoLogin().replacements.ip).toBe('198.51.100.7');
      expect(logDoLogin().replacements.ip).toBe('198.51.100.7');
      expect(logDoLogin().replacements.mensagem).toMatch(/via_proxy=(127\.0\.0\.1|::1)/);
    });

    test('loopback sem IP do cliente: vale só o limite por login', async () => {
      on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 999 }]);
      const res = await request(app).post('/api/login').send({ login: 'a@teste.local', password: 'x' });
      expect(res.status).not.toBe(429);
      expect(rateDoLogin().replacements.ip).toBeNull();
    });

    test('loopback com IP do cliente inválido é ignorado', async () => {
      await request(app).post('/api/login').send({ login: 'a@teste.local', password: 'x', ip: 'nao-e-ip' });
      expect(rateDoLogin().replacements.ip).toBeNull();
    });

    test('cliente externo com X-Client-IP forjado continua limitado pelo IP real', async () => {
      on(SQL_RATE, (r) => [{ falhas_login: 0, falhas_ip: r.ip === '203.0.113.9' ? 30 : 0 }]);
      const res = await request(app).post('/api/login')
        .set('X-Forwarded-For', '203.0.113.9')
        .set('X-Client-IP', '198.51.100.7')
        .send({ login: 'a@teste.local', password: 'x' });
      expect(res.status).toBe(429);
    });

    test('TRUSTED_PROXY_IPS: o IP do servidor PHP também é proxy confiável', async () => {
      process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
      try {
        await request(app).post('/api/login')
          .set('X-Forwarded-For', '192.0.2.50')
          .set('X-Client-IP', '198.51.100.8')
          .send({ login: 'a@teste.local', password: 'x' });
        expect(rateDoLogin().replacements.ip).toBe('198.51.100.8');
      } finally {
        delete process.env.TRUSTED_PROXY_IPS;
      }
    });
  });

  test('login com bcrypt válido devolve JWT com tv atual', async () => {
    const hash = await bcrypt.hash('senha123', 4);
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => [{ id: 10, id_condominio: 1, email: 'a@teste.local', senha_hash: hash, status: 'ativo', tipo_perfil_id: 2 }]);
    fakeDb._fake.setUsuarioSessao(10, { token_version: 4 });
    const res = await request(app).post('/api/login').send({ login: 'a@teste.local', password: 'senha123' });
    expect(res.body.check).toBe(true);
    expect(jwt.decode(res.body.token).tv).toBe(4);
  });

  // Primeiro acesso / redefinição forçada: senha_hash NULL, vazio, marcador ou
  // senha legada em texto puro nunca autenticam (o caminho é a recuperação).
  test.each([
    ['NULL', null, 'qualquer'],
    ['vazio', '', ''],
    ['marcador RESET', 'RESET', 'RESET'],
    ['texto puro legado', 'senha123', 'senha123']
  ])('senha_hash %s não autentica', async (_nome, senhaHash, senhaDigitada) => {
    on(SQL_RATE, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(SQL_LOGIN, () => [{ id: 10, id_condominio: 1, email: 'a@teste.local', senha_hash: senhaHash, status: 'ativo', tipo_perfil_id: 2 }]);
    const res = await request(app).post('/api/login').send({ login: 'a@teste.local', password: senhaDigitada || 'x' });
    expect(res.body.check).toBe(false);
    expect(res.body.token).toBeUndefined();
    expect(callsMatching(/SET senha_hash = :senha_hash WHERE id = :id/)).toHaveLength(0);
  });
});
