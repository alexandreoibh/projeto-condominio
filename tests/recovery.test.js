'use strict';

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { despacharEmail } = require('../src/service/emailDispatchService');
const { recuperacaoLegada, sessao, PERFIL } = require('./helpers/tokens');

const { on, callsMatching } = fakeDb._fake;
const SQL_BUSCA_USUARIO = /FROM "condominio-bh"\."tb-usuarios" tu\s+LEFT JOIN "condominio-bh"\."tb-condominios" tc/;
const SQL_RATE = /FROM "condominio-bh"\.tb_recovery_tokens\s+WHERE created_at > NOW\(\)/;

const VITIMA = {
  id: 10, id_condominio: 1, nome: 'Vitima', sobrenome: 'Teste', email: 'vitima@teste.local', status: 'ativo', condominio_ativo: true
};

// Simula tb_recovery_tokens em memória com a mesma semântica atômica do SQL.
function instalarTabelaRecovery() {
  const linhas = [];
  let proximoId = 1;

  on(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/, (r) => {
    linhas.push({
      id: proximoId++, id_usuario: r.id_usuario, code_hash: r.code_hash, expires_at: r.expires_at,
      attempts: 0, consumed_at: null, reset_token_hash: null, reset_expires_at: null, reset_used_at: null, created_at: new Date()
    });
    return [[], 1];
  });
  on(/SET consumed_at = NOW\(\), updated_at = NOW\(\)\s+WHERE id_usuario = :id_usuario AND consumed_at IS NULL/, (r) => {
    linhas.filter((l) => l.id_usuario === r.id_usuario && !l.consumed_at).forEach((l) => { l.consumed_at = new Date(); });
    return [[], 1];
  });
  on(/SELECT id, code_hash, expires_at, attempts\s+FROM "condominio-bh"\.tb_recovery_tokens/, (r) => {
    const pendentes = linhas.filter((l) => l.id_usuario === r.id_usuario && !l.consumed_at);
    return pendentes.length ? [pendentes[pendentes.length - 1]] : [];
  });
  on(/SET attempts = attempts \+ 1/, (r) => {
    const linha = linhas.find((l) => l.id === r.id && !l.consumed_at && l.attempts < r.max);
    if (!linha) return [];
    linha.attempts += 1;
    return [{ id: linha.id }];
  });
  on(/SET consumed_at = NOW\(\),\s+reset_token_hash = :reset_token_hash/, (r) => {
    const linha = linhas.find((l) => l.id === r.id && !l.consumed_at);
    if (!linha) return [];
    linha.consumed_at = new Date();
    linha.reset_token_hash = r.reset_token_hash;
    linha.reset_expires_at = r.reset_expires_at;
    return [{ id: linha.id }];
  });
  on(/SET reset_used_at = NOW\(\), updated_at = NOW\(\)\s+WHERE reset_token_hash = :hash/, (r) => {
    const linha = linhas.find((l) =>
      l.reset_token_hash === r.hash && l.id_usuario === r.id_usuario && !l.reset_used_at && l.reset_expires_at > new Date());
    if (!linha) return [];
    linha.reset_used_at = new Date();
    return [{ id: linha.id, id_condominio: 1 }];
  });
  on(/UPDATE "condominio-bh"\."tb-usuarios"\s+SET senha_hash = :senha_hash/, (r) => [{ id: r.id, id_condominio: 1 }]);
  return linhas;
}

function instalarUsuario(usuario = VITIMA, { porUsuario = 0, porIp = 0 } = {}) {
  on(SQL_BUSCA_USUARIO, (r) => (usuario && (r.email === usuario.email || r.cpf === '12345678909') ? [usuario] : []));
  on(SQL_RATE, () => [{ por_usuario: porUsuario, por_ip: porIp }]);
}

// Captura o código enviado por e-mail (o teste lê o "e-mail" mockado).
async function codigoEnviado() {
  await global.aguardarPendentes();
  const chamada = despacharEmail.mock.calls[despacharEmail.mock.calls.length - 1];
  return chamada ? chamada[0].token : null;
}

beforeEach(() => despacharEmail.mockClear());

describe('POST /api/condominio/auth-recovery-lookup (frontend PHP)', () => {
  test('não devolve invite_token, token nem dados do usuário', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const res = await request(app).post('/api/condominio/auth-recovery-lookup').send({ login: VITIMA.email });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/invite_token|"token"|eyJ/);
    // o código vai por e-mail, só para o e-mail cadastrado
    const codigo = await codigoEnviado();
    expect(codigo).toMatch(/^\d{6}$/);
    expect(despacharEmail.mock.calls[0][0].email).toBe(VITIMA.email);
  });

  test('responde igual para usuário existente e inexistente (sem enumeração)', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const existente = await request(app).post('/api/condominio/auth-recovery-lookup').send({ login: VITIMA.email });
    const inexistente = await request(app).post('/api/condominio/auth-recovery-lookup').send({ login: 'ninguem@teste.local' });
    expect(inexistente.status).toBe(existente.status);
    expect(inexistente.body).toEqual(existente.body);
  });

  test('a rota .php e o prefixo /service também não vazam token', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    for (const rota of ['/api/condominio/auth-recovery-lookup.php', '/service/auth-recovery-lookup']) {
      const res = await request(app).post(rota).send({ login: VITIMA.email });
      expect(res.status).toBe(200);
      expect(res.body.invite_token).toBeUndefined();
      expect(res.body.token).toBeUndefined();
    }
  });

  test('rate limit por usuário: não cria desafio nem envia e-mail, resposta continua genérica', async () => {
    instalarTabelaRecovery();
    instalarUsuario(VITIMA, { porUsuario: 3 });
    const res = await request(app).post('/api/condominio/auth-recovery-lookup').send({ login: VITIMA.email });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/)).toHaveLength(0);
    await global.aguardarPendentes();
    expect(despacharEmail).not.toHaveBeenCalled();
  });

  describe('IP do cliente via proxy (back-cond.php em localhost)', () => {
    const LOOKUP = '/api/condominio/auth-recovery-lookup';
    const ipDoRate = () => callsMatching(SQL_RATE)[0].replacements.ip;
    const ipGravado = () => callsMatching(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/)[0]?.replacements.request_ip;

    test('loopback com X-Client-IP: limite e request_ip usam o IP do morador', async () => {
      instalarTabelaRecovery();
      instalarUsuario();
      await request(app).post(LOOKUP).set('X-Client-IP', '198.51.100.7').send({ login: VITIMA.email });
      expect(ipDoRate()).toBe('198.51.100.7');
      expect(ipGravado()).toBe('198.51.100.7');
    });

    test('loopback sem IP do morador: o limite por IP (do servidor PHP) não bloqueia ninguém', async () => {
      instalarTabelaRecovery();
      instalarUsuario(VITIMA, { porIp: 999 });
      await request(app).post(LOOKUP).send({ login: VITIMA.email });
      expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/)).toHaveLength(1);
      expect(await codigoEnviado()).toMatch(/^\d{6}$/);
    });

    test('cliente externo com X-Client-IP forjado continua limitado pelo IP real', async () => {
      instalarTabelaRecovery();
      instalarUsuario();
      on(SQL_RATE, (r) => [{ por_usuario: 0, por_ip: r.ip === '203.0.113.9' ? 10 : 0 }]);
      const res = await request(app).post(LOOKUP)
        .set('X-Forwarded-For', '203.0.113.9')
        .set('X-Client-IP', '198.51.100.7')
        .send({ login: VITIMA.email });
      expect(res.status).toBe(200);
      expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/)).toHaveLength(0);
      await global.aguardarPendentes();
      expect(despacharEmail).not.toHaveBeenCalled();
    });
  });
});

describe('Fluxo request → verify → reset (app React)', () => {
  async function obterResetToken() {
    const linhas = instalarTabelaRecovery();
    instalarUsuario();
    const req = await request(app).post('/api/auth/recovery/request').send({ login: VITIMA.email });
    expect(req.status).toBe(200);
    const codigo = await codigoEnviado();
    const ver = await request(app).post('/api/auth/recovery/verify').send({ user_id: VITIMA.id, code: codigo });
    expect(ver.status).toBe(200);
    return { resetToken: ver.body.invite_token, linhas, corpo: ver.body };
  }

  test('o reset token é opaco e só o sha256 é gravado', async () => {
    const { resetToken, linhas, corpo } = await obterResetToken();
    expect(resetToken).toBeTruthy();
    expect(resetToken.split('.')).toHaveLength(1); // não é JWT
    expect(corpo.token_type).toBe('reset_token');
    const hash = crypto.createHash('sha256').update(resetToken).digest('hex');
    expect(linhas[0].reset_token_hash).toBe(hash);
    expect(JSON.stringify(linhas)).not.toContain(resetToken);
  });

  test('reset válido troca a senha e revoga sessões; o token não pode ser reutilizado', async () => {
    const { resetToken } = await obterResetToken();
    fakeDb._fake.setUsuarioSessao(VITIMA.id, { token_version: 0 });

    const primeiro = await request(app).post('/api/auth/recovery/reset')
      .send({ user_id: VITIMA.id, invite_token: resetToken, password: 'NovaSenha#1' });
    expect(primeiro.status).toBe(200);
    expect(fakeDb._fake.state.usuarios.get(VITIMA.id).token_version).toBe(1);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/).length).toBeGreaterThan(0);

    const segundo = await request(app).post('/api/auth/recovery/reset')
      .send({ user_id: VITIMA.id, invite_token: resetToken, password: 'OutraSenha#2' });
    expect(segundo.status).toBe(401);
  });

  test('sessão emitida antes do reset deixa de valer', async () => {
    const tokenAntigo = sessao({ id: VITIMA.id, perfil: PERFIL.MORADOR, tv: 0 });
    const { resetToken } = await obterResetToken();
    fakeDb._fake.setUsuarioSessao(VITIMA.id, { token_version: 0 });
    await request(app).post('/api/auth/recovery/reset').send({ user_id: VITIMA.id, invite_token: resetToken, password: 'NovaSenha#1' });

    const res = await request(app).get('/api/condominio/perfis').set('Authorization', `Bearer ${tokenAntigo}`);
    expect(res.status).toBe(401);
  });

  test('token de outro usuário é recusado', async () => {
    const { resetToken } = await obterResetToken();
    const res = await request(app).post('/api/auth/recovery/reset')
      .send({ user_id: 999, invite_token: resetToken, password: 'NovaSenha#1' });
    expect(res.status).toBe(401);
  });

  test('token expirado é recusado', async () => {
    const { resetToken, linhas } = await obterResetToken();
    linhas[0].reset_expires_at = new Date(Date.now() - 1000);
    const res = await request(app).post('/api/auth/recovery/reset')
      .send({ user_id: VITIMA.id, invite_token: resetToken, password: 'NovaSenha#1' });
    expect(res.status).toBe(401);
  });

  test('código expirado é recusado no verify', async () => {
    const linhas = instalarTabelaRecovery();
    instalarUsuario();
    await request(app).post('/api/auth/recovery/request').send({ login: VITIMA.email });
    const codigo = await codigoEnviado();
    linhas[0].expires_at = new Date(Date.now() - 1000);
    const res = await request(app).post('/api/auth/recovery/verify').send({ user_id: VITIMA.id, code: codigo });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CODE_EXPIRED');
  });

  test('após 5 tentativas erradas o desafio é bloqueado (inclusive para o código certo)', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    await request(app).post('/api/auth/recovery/request').send({ login: VITIMA.email });
    const codigo = await codigoEnviado();
    const errado = codigo === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/api/auth/recovery/verify').send({ user_id: VITIMA.id, code: errado });
      expect(r.status).toBe(401);
    }
    const bloqueado = await request(app).post('/api/auth/recovery/verify').send({ user_id: VITIMA.id, code: codigo });
    expect(bloqueado.status).toBe(429);
  });

  test('verify aceita login no lugar de user_id (app novo)', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    await request(app).post('/api/auth/recovery/request').send({ login: VITIMA.email });
    const codigo = await codigoEnviado();
    const res = await request(app).post('/api/auth/recovery/verify').send({ login: VITIMA.email, code: codigo });
    expect(res.status).toBe(200);
    expect(res.body.reset_token).toBeTruthy();
  });
});

describe('Cadeia do incidente: token de recuperação antigo (JWT)', () => {
  test('não redefine senha em /api/auth/recovery/reset', async () => {
    instalarTabelaRecovery();
    const res = await request(app).post('/api/auth/recovery/reset')
      .send({ user_id: 10, invite_token: recuperacaoLegada({ id_usuario: 10 }), password: 'Invasor#1' });
    expect(res.status).toBe(401);
    expect(callsMatching(/SET senha_hash = :senha_hash/)).toHaveLength(0);
  });

  test('não autentica PUT /usuarios/:id (troca de senha + perfil Admin)', async () => {
    const res = await request(app).put('/api/condominio/usuarios/10')
      .send({ invite_token: recuperacaoLegada({ id_usuario: 10 }), password: 'Invasor#1', tipo_perfil_id: 1 });
    expect(res.status).toBe(401);
    expect(callsMatching(/UPDATE "condominio-bh"\."tb-usuarios"/)).toHaveLength(0);
  });
});
