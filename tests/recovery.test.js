'use strict';

// Recuperação de senha (hardening 25/11/2026). Banco simulado (fakeDb com
// tb_rate_limit em memória), e-mail mockado, rede bloqueada.

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { despacharEmail } = require('../src/service/emailDispatchService');
const { recuperacaoLegada, sessao, PERFIL } = require('./helpers/tokens');

const { on, callsMatching, state } = fakeDb._fake;
const SQL_BUSCA_USUARIO = /FROM "condominio-bh"\."tb-usuarios" tu\s+LEFT JOIN "condominio-bh"\."tb-condominios" tc/;
const SENHA_OK = 'Senha-Forte-2026!';
const LOOKUP = '/api/condominio/auth-recovery-lookup';
const REQUEST = '/api/auth/recovery/request';
const VERIFY = '/api/auth/recovery/verify';
const RESET = '/api/auth/recovery/reset';
const VERIFY_PHP = '/api/condominio/auth-recovery-verify-code';

const VITIMA = {
  id: 10, id_condominio: 1, nome: 'Vitima', sobrenome: 'Teste', email: 'vitima@teste.local',
  cpf: '52998224725', status: 'ativo', condominio_ativo: true
};

// tb_recovery_tokens em memória com a mesma semântica atômica do SQL.
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

function instalarUsuario(usuario = VITIMA) {
  on(SQL_BUSCA_USUARIO, (r) => (usuario && ((r.email && r.email === usuario.email) || (r.cpf && r.cpf === usuario.cpf)) ? [usuario] : []));
}

async function ultimoEmail() {
  await global.aguardarPendentes();
  const chamada = despacharEmail.mock.calls[despacharEmail.mock.calls.length - 1];
  return chamada ? chamada[0] : null;
}

// Fluxo do app: request → verify (com o user_id recebido) → reset token.
async function obterResetToken(login = VITIMA.email) {
  const pedido = await request(app).post(REQUEST).send({ login });
  expect(pedido.status).toBe(200);
  const codigo = (await ultimoEmail()).token;
  const ver = await request(app).post(VERIFY).send({ user_id: pedido.body.user_id, code: codigo });
  expect(ver.status).toBe(200);
  return { userId: pedido.body.user_id, resetToken: ver.body.reset_token, codigo };
}

const desafiosCriados = () => callsMatching(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/).length;
const auditorias = () => JSON.stringify(callsMatching(/INSERT INTO "condominio-bh"\.tb_auditoria_seguranca/).map((c) => c.replacements));

beforeEach(() => {
  despacharEmail.mockClear();
  delete process.env.TRUSTED_PROXY_IPS;
});

// ---------------------------------------------------------------------------
describe('Recuperação legítima completa', () => {
  test('request → verify (identificador opaco) → reset; sessões anteriores caem', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const tokenAntigo = sessao({ id: VITIMA.id, perfil: PERFIL.MORADOR, tv: 0 });

    const { userId, resetToken } = await obterResetToken();
    expect(String(userId)).toMatch(/^rh1\./);
    expect(resetToken.split('.')).toHaveLength(1); // opaco, não é JWT
    expect((await ultimoEmail()).email).toBe(VITIMA.email);

    const reset = await request(app).post(RESET).send({ user_id: userId, reset_token: resetToken, password: SENHA_OK });
    expect(reset.status).toBe(200);
    const update = callsMatching(/UPDATE "condominio-bh"\."tb-usuarios"\s+SET senha_hash = :senha_hash/)[0];
    expect(update.replacements.senha_hash).toMatch(/^\$2[aby]\$/);
    expect(update.sql).toContain('token_version = COALESCE(token_version, 0) + 1');
    expect(update.options.transaction).toBeTruthy();

    const depois = await request(app).get('/api/condominio/perfis').set('Authorization', `Bearer ${tokenAntigo}`);
    expect(depois.status).toBe(401);
  });

  test('código é guardado como HMAC vinculado ao desafio (h1:nonce:mac), nunca em claro', async () => {
    const linhas = instalarTabelaRecovery();
    instalarUsuario();
    await request(app).post(REQUEST).send({ login: VITIMA.email });
    const { token: codigo } = await ultimoEmail();
    expect(linhas[0].code_hash).toMatch(/^h1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(linhas[0].code_hash).not.toContain(codigo);
    // Dois desafios com o mesmo código geram hashes diferentes (nonce).
    const [, nonce] = linhas[0].code_hash.split(':');
    expect(nonce.length).toBeGreaterThanOrEqual(20);
  });

  test('PHP: lookup → verify-code (email) → reset com user_id numérico', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const lookup = await request(app).post(LOOKUP).send({ login: VITIMA.email });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual({ success: true, message: expect.any(String) });
    const { token: codigo } = await ultimoEmail();
    const ver = await request(app).post(VERIFY_PHP).send({ email: VITIMA.email, code: codigo });
    expect(ver.status).toBe(200);
    expect(ver.body.user_id).toBe(VITIMA.id);
    const reset = await request(app).post(RESET).send({ user_id: ver.body.user_id, reset_token: ver.body.reset_token, password: SENHA_OK });
    expect(reset.status).toBe(200);
  });

  test('senha NULL/legada: recupera normalmente (elegibilidade não depende do hash)', async () => {
    instalarTabelaRecovery();
    instalarUsuario({ ...VITIMA, senha_hash: null });
    const { userId, resetToken } = await obterResetToken();
    const reset = await request(app).post(RESET).send({ user_id: userId, reset_token: resetToken, password: SENHA_OK });
    expect(reset.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('Anti-enumeração', () => {
  test('usuário inexistente: mesmo status e mesmos campos; nenhum e-mail', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const existe = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const naoExiste = await request(app).post(REQUEST).send({ login: 'ninguem@teste.local' });
    expect(naoExiste.status).toBe(existe.status);
    expect(Object.keys(naoExiste.body).sort()).toEqual(Object.keys(existe.body).sort());
    expect(naoExiste.body.message).toBe(existe.body.message);
    expect(String(naoExiste.body.user_id)).toMatch(/^rh1\./);
    await global.aguardarPendentes();
    expect(despacharEmail).toHaveBeenCalledTimes(1); // só o existente

    const lookupExiste = await request(app).post(LOOKUP).send({ login: VITIMA.email });
    const lookupNaoExiste = await request(app).post(LOOKUP).send({ login: 'outro@teste.local' });
    expect(lookupNaoExiste.status).toBe(lookupExiste.status);
    expect(lookupNaoExiste.body).toEqual(lookupExiste.body);
  });

  test('identificador rh1 não expõe e-mail nem CPF e é diferente a cada chamada', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const a = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const b = await request(app).post(REQUEST).send({ login: VITIMA.cpf });
    for (const id of [a.body.user_id, b.body.user_id]) {
      const bruto = Buffer.from(id.slice(4), 'base64url').toString('latin1');
      expect(bruto).not.toContain('vitima');
      expect(bruto).not.toContain(VITIMA.cpf);
      expect(id).not.toContain('vitima');
    }
    expect(a.body.user_id).not.toBe(b.body.user_id);
  });

  test('rh1 adulterado ou de outro segredo → INVALID_CODE (sem 500)', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const { body } = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const adulterado = body.user_id.slice(0, -3) + (body.user_id.endsWith('AAA') ? 'BBB' : 'AAA');
    const res = await request(app).post(VERIFY).send({ user_id: adulterado, code: '123456' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CODE');
  });

  test('código errado, sem desafio e conta inexistente respondem igual', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const pedido = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const errado = await request(app).post(VERIFY).send({ user_id: pedido.body.user_id, code: '000000' });
    const fantasma = await request(app).post(REQUEST).send({ login: 'fantasma@teste.local' });
    const inexistente = await request(app).post(VERIFY).send({ user_id: fantasma.body.user_id, code: '000000' });
    expect(errado.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(inexistente.body).toEqual(errado.body);
  });
});

// ---------------------------------------------------------------------------
describe('Destinatário, código e token', () => {
  test('e-mail/destino alternativo no body é ignorado', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    await request(app).post(REQUEST).send({ login: VITIMA.email, email: 'atacante@evil.tld', destino: 'atacante@evil.tld' });
    await request(app).post(LOOKUP).send({ login: VITIMA.cpf, email: 'atacante@evil.tld' });
    await global.aguardarPendentes();
    for (const [payload] of despacharEmail.mock.calls) {
      expect(payload.email).toBe(VITIMA.email);
    }
  });

  test('código expirado é recusado', async () => {
    const linhas = instalarTabelaRecovery();
    instalarUsuario();
    const pedido = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const { token: codigo } = await ultimoEmail();
    linhas[0].expires_at = new Date(Date.now() - 1000);
    const res = await request(app).post(VERIFY).send({ user_id: pedido.body.user_id, code: codigo });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CODE');
  });

  test('código reutilizado após sucesso é recusado', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const { userId, codigo } = await obterResetToken();
    const res = await request(app).post(VERIFY).send({ user_id: userId, code: codigo });
    expect(res.status).toBe(401);
  });

  test('após 5 tentativas no desafio, nem o código certo passa', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const pedido = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const { token: codigo } = await ultimoEmail();
    const errado = codigo === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post(VERIFY).send({ user_id: pedido.body.user_id, code: errado })).status).toBe(401);
    }
    const sexta = await request(app).post(VERIFY).send({ user_id: pedido.body.user_id, code: codigo });
    expect(sexta.status).toBe(401);
    expect(sexta.body.reset_token).toBeUndefined();
  });

  test('reset token reutilizado ou expirado é recusado', async () => {
    const linhas = instalarTabelaRecovery();
    instalarUsuario();
    state.relogio = Date.now();
    const { userId, resetToken } = await obterResetToken();
    expect((await request(app).post(RESET).send({ user_id: userId, reset_token: resetToken, password: SENHA_OK })).status).toBe(200);
    expect((await request(app).post(RESET).send({ user_id: userId, reset_token: resetToken, password: SENHA_OK })).status).toBe(401);

    state.relogio += 61 * 1000; // passa o cooldown de 60 s entre envios
    const segundo = await obterResetToken();
    linhas[linhas.length - 1].reset_expires_at = new Date(Date.now() - 1000);
    expect((await request(app).post(RESET).send({ user_id: segundo.userId, reset_token: segundo.resetToken, password: SENHA_OK })).status).toBe(401);
  });

  test('token de outra conta é recusado', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const { resetToken } = await obterResetToken();
    const res = await request(app).post(RESET).send({ user_id: 999, reset_token: resetToken, password: SENHA_OK });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('Política de senha (reset)', () => {
  test.each([
    ['14 caracteres', 'a'.repeat(14), 422, 'WEAK_PASSWORD'],
    ['15 espaços', ' '.repeat(15), 422, 'WEAK_PASSWORD'],
    ['acima de 72 bytes (40 × "ç" = 80 bytes)', 'ç'.repeat(40), 422, 'PASSWORD_TOO_LONG'],
    ['65 caracteres ASCII (65 bytes)', 'a'.repeat(65), 422, 'PASSWORD_TOO_LONG'],
    ['64 caracteres ASCII', 'a'.repeat(64), 200, undefined],
    ['15 caracteres', 'a'.repeat(15), 200, undefined]
  ])('%s', async (_nome, senha, status, codigo) => {
    instalarTabelaRecovery();
    instalarUsuario();
    const { userId, resetToken } = await obterResetToken();
    const res = await request(app).post(RESET).send({ user_id: userId, reset_token: resetToken, password: senha });
    expect(res.status).toBe(status);
    if (codigo) {
      expect(res.body.code).toBe(codigo);
      expect(callsMatching(/SET reset_used_at = NOW\(\)/)).toHaveLength(0); // token não foi consumido
    }
  });
});

// ---------------------------------------------------------------------------
describe('Rate limit persistente', () => {
  test('10 solicitações por IP por hora; a 11ª → 429', async () => {
    instalarTabelaRecovery();
    instalarUsuario(null);
    for (let i = 0; i < 10; i += 1) {
      const r = await request(app).post(REQUEST).set('X-Forwarded-For', '203.0.113.20').send({ login: `u${i}@teste.local` });
      expect(r.status).toBe(200);
    }
    const bloqueada = await request(app).post(REQUEST).set('X-Forwarded-For', '203.0.113.20').send({ login: 'u99@teste.local' });
    expect(bloqueada.status).toBe(429);
    // Outro IP continua livre.
    expect((await request(app).post(REQUEST).set('X-Forwarded-For', '203.0.113.21').send({ login: 'x@teste.local' })).status).toBe(200);
  });

  test('concorrência: 20 solicitações paralelas do mesmo IP → exatamente 10 passam', async () => {
    instalarTabelaRecovery();
    instalarUsuario(null);
    const respostas = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      request(app).post(REQUEST).set('X-Forwarded-For', '203.0.113.30').send({ login: `p${i}@teste.local` })));
    expect(respostas.filter((r) => r.status === 200)).toHaveLength(10);
    expect(respostas.filter((r) => r.status === 429)).toHaveLength(10);
  });

  test('concorrência: verifies paralelos com o código certo → um único reset token', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const pedido = await request(app).post(REQUEST).send({ login: VITIMA.email });
    const { token: codigo } = await ultimoEmail();
    const respostas = await Promise.all(Array.from({ length: 5 }, () =>
      request(app).post(VERIFY).send({ user_id: pedido.body.user_id, code: codigo })));
    expect(respostas.filter((r) => r.status === 200)).toHaveLength(1);
  });

  test('cooldown de 60 s por conta: segundo envio imediato não manda e-mail; após 61 s manda', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    state.relogio = Date.now();
    await request(app).post(REQUEST).send({ login: VITIMA.email });
    const segundo = await request(app).post(REQUEST).send({ login: VITIMA.email });
    expect(segundo.status).toBe(200); // resposta genérica
    expect(desafiosCriados()).toBe(1);
    state.relogio += 61 * 1000;
    await request(app).post(REQUEST).send({ login: VITIMA.email });
    expect(desafiosCriados()).toBe(2);
  });

  test('limite por conta soma e-mail e CPF da mesma conta (3/h)', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    state.relogio = Date.now();
    const logins = [VITIMA.email, VITIMA.cpf, VITIMA.email, VITIMA.cpf];
    for (const login of logins) {
      await request(app).post(REQUEST).send({ login });
      state.relogio += 61 * 1000; // passa o cooldown
    }
    expect(desafiosCriados()).toBe(3);
  });

  test('30 falhas de verificação por IP por hora; acerto devolve a reserva (sem negativo)', async () => {
    instalarTabelaRecovery();
    instalarUsuario(null);
    for (let i = 0; i < 30; i += 1) {
      const r = await request(app).post(VERIFY).set('X-Forwarded-For', '203.0.113.40').send({ login: `f${i}@teste.local`, code: '123456' });
      expect(r.status).toBe(401);
    }
    const bloqueada = await request(app).post(VERIFY).set('X-Forwarded-For', '203.0.113.40').send({ login: 'f99@teste.local', code: '123456' });
    expect(bloqueada.status).toBe(429);
    for (const linha of state.rateLimit.values()) expect(linha.contador).toBeGreaterThanOrEqual(0);
  });

  test('10 falhas por login por hora, mesmo variando o IP', async () => {
    instalarUsuario(null);
    for (let i = 0; i < 10; i += 1) {
      const r = await request(app).post(VERIFY).set('X-Forwarded-For', `203.0.113.${100 + i}`).send({ login: 'alvo@teste.local', code: '123456' });
      expect(r.status).toBe(401);
    }
    const bloqueada = await request(app).post(VERIFY).set('X-Forwarded-For', '203.0.113.200').send({ login: 'alvo@teste.local', code: '123456' });
    expect(bloqueada.status).toBe(429);
  });

  test('acerto no verify devolve as reservas na janela original', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    await obterResetToken();
    const linhaIp = [...state.rateLimit.values()].find((l) => l.chave.startsWith('rec:vf:ip:'));
    expect(linhaIp.contador).toBe(0);
  });

  test('limite global de solicitações → 429', async () => {
    instalarUsuario(null);
    on(/INSERT INTO "condominio-bh"\.tb_rate_limit/, (r) => [{ contador: r.chave === 'rec:req:global' ? 501 : 1, janela: new Date() }]);
    const res = await request(app).post(REQUEST).send({ login: 'x@teste.local' });
    expect(res.status).toBe(429);
  });

  test.each([
    ['lookup', LOOKUP, { login: VITIMA.email }],
    ['request', REQUEST, { login: VITIMA.email }],
    ['verify', VERIFY, { login: VITIMA.email, code: '123456' }],
    ['verify-code', VERIFY_PHP, { email: VITIMA.email, code: '123456' }],
    ['reset', RESET, { user_id: 10, reset_token: 'x'.repeat(43), password: SENHA_OK }]
  ])('armazenamento de rate limit indisponível → 503 em %s, sem e-mail e sem reset', async (_n, rota, corpo) => {
    instalarTabelaRecovery();
    instalarUsuario();
    on(/"condominio-bh"\.tb_rate_limit/, () => { throw new Error('relation "tb_rate_limit" does not exist'); });
    const res = await request(app).post(rota).send(corpo);
    expect(res.status).toBe(503);
    await global.aguardarPendentes();
    expect(despacharEmail).not.toHaveBeenCalled();
    expect(callsMatching(/SET senha_hash = :senha_hash/)).toHaveLength(0);
    expect(callsMatching(/INSERT INTO "condominio-bh"\.tb_recovery_tokens/)).toHaveLength(0);
  });

  test('RECOVERY_CODE_SECRET ausente → 503', async () => {
    const original = process.env.RECOVERY_CODE_SECRET;
    delete process.env.RECOVERY_CODE_SECRET;
    try {
      instalarUsuario();
      expect((await request(app).post(REQUEST).send({ login: VITIMA.email })).status).toBe(503);
    } finally {
      process.env.RECOVERY_CODE_SECRET = original;
    }
  });
});

// ---------------------------------------------------------------------------
describe('IP real e proxy autenticado', () => {
  const chaveIp = () => [...state.rateLimit.values()].map((l) => l.chave).find((c) => c.startsWith('rec:req:ip:'));

  test('chamada direta: X-Forwarded-For com itens forjados à esquerda; vale só o último (o da Vercel)', async () => {
    instalarUsuario(null);
    await request(app).post(REQUEST)
      .set('X-Forwarded-For', '6.6.6.6, 7.7.7.7, 203.0.113.9')
      .set('X-Real-IP', '8.8.8.8')
      .set('X-Vercel-Forwarded-For', '9.9.9.9')
      .send({ login: 'a@teste.local' });
    expect(chaveIp()).toBe('rec:req:ip:203.0.113.9');
  });

  test('chamada direta: X-Client-IP forjado é ignorado; vale o IP observado', async () => {
    instalarUsuario(null);
    await request(app).post(REQUEST).set('X-Forwarded-For', '203.0.113.9').set('X-Client-IP', '198.51.100.7').send({ login: 'a@teste.local', ip: '1.1.1.1' });
    expect(chaveIp()).toBe('rec:req:ip:203.0.113.9');
  });

  test('proxy confiável sem X-Proxy-Key → 401 (não ignora o limite por IP)', async () => {
    process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
    instalarUsuario(null);
    const res = await request(app).post(LOOKUP).set('X-Forwarded-For', '192.0.2.50').set('X-Client-IP', '198.51.100.8').send({ login: 'a@teste.local' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('proxy_nao_autenticado');
    expect(state.rateLimit.size).toBe(0);
  });

  test('proxy confiável com chave errada → 401', async () => {
    process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
    const res = await request(app).post(LOOKUP).set('X-Forwarded-For', '192.0.2.50').set('X-Proxy-Key', 'errada').set('X-Client-IP', '198.51.100.8').send({ login: 'a@teste.local' });
    expect(res.status).toBe(401);
  });

  test('proxy confiável com chave certa e X-Client-IP inválido → 400', async () => {
    process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
    const res = await request(app).post(LOOKUP).set('X-Forwarded-For', '192.0.2.50')
      .set('X-Proxy-Key', process.env.PROXY_SHARED_SECRET).set('X-Client-IP', 'nao-e-ip').send({ login: 'a@teste.local' });
    expect(res.status).toBe(400);
  });

  test('proxy confiável autenticado: o limite usa o IP do morador', async () => {
    process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
    instalarUsuario(null);
    const res = await request(app).post(LOOKUP).set('X-Forwarded-For', '192.0.2.50')
      .set('X-Proxy-Key', process.env.PROXY_SHARED_SECRET).set('X-Client-IP', '198.51.100.8').send({ login: 'a@teste.local' });
    expect(res.status).toBe(200);
    expect(chaveIp()).toBe('rec:req:ip:198.51.100.8');
  });

  test('proxy confiável sem PROXY_SHARED_SECRET configurado → 503', async () => {
    process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
    const original = process.env.PROXY_SHARED_SECRET;
    delete process.env.PROXY_SHARED_SECRET;
    try {
      const res = await request(app).post(LOOKUP).set('X-Forwarded-For', '192.0.2.50').set('X-Proxy-Key', 'x').set('X-Client-IP', '198.51.100.8').send({ login: 'a@teste.local' });
      expect(res.status).toBe(503);
    } finally {
      process.env.PROXY_SHARED_SECRET = original;
    }
  });

  test('o login (ipCliente.js) não foi alterado: proxy confiável sem chave segue aceito lá', async () => {
    process.env.TRUSTED_PROXY_IPS = '192.0.2.50';
    on(/FROM "condominio-bh"\.tb_sgw_log_acesso\s+WHERE acao = 'LOGIN'/, () => [{ falhas_login: 0, falhas_ip: 0 }]);
    on(/tu\.senha_hash,[\s\S]*FROM "condominio-bh"\."tb-usuarios" tu/, () => []);
    const res = await request(app).post('/api/login').set('X-Forwarded-For', '192.0.2.50').set('X-Client-IP', '198.51.100.8').send({ login: 'a@teste.local', password: 'x' });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('Separação de chaves (HKDF)', () => {
  const cripto = require('../src/helpers/recuperacaoCripto');

  test('subchaves de rh1, código e login são distintas entre si e da chave mestra', () => {
    const rh1 = cripto._subchave('rh1');
    const codigo = cripto._subchave('codigo');
    const login = cripto._subchave('rate-login');
    expect(rh1.length).toBe(32);
    expect(rh1.equals(codigo)).toBe(false);
    expect(rh1.equals(login)).toBe(false);
    expect(codigo.equals(login)).toBe(false);
    expect(rh1.toString('utf8')).not.toContain(process.env.RECOVERY_CODE_SECRET);
  });

  test('rh1 não abre com a subchave do código (nem o MAC do código confere com a do rh1)', () => {
    const id = cripto.emitirIdentificador('vitima@teste.local');
    const bruto = Buffer.from(id.slice(4), 'base64url');
    const decifra = crypto.createDecipheriv('aes-256-gcm', cripto._subchave('codigo'), bruto.subarray(0, 12));
    decifra.setAuthTag(bruto.subarray(bruto.length - 16));
    expect(() => Buffer.concat([decifra.update(bruto.subarray(12, bruto.length - 16)), decifra.final()])).toThrow();
    expect(cripto.abrirIdentificador(id)).toBe('vitima@teste.local');
  });

  test('outra chave mestra invalida rh1 e códigos emitidos', async () => {
    const id = cripto.emitirIdentificador('vitima@teste.local');
    const hash = cripto.hashCodigo(10, '123456');
    const original = process.env.RECOVERY_CODE_SECRET;
    process.env.RECOVERY_CODE_SECRET = 'outra-chave-mestra-de-teste-0123456789abcdef';
    try {
      expect(cripto.abrirIdentificador(id)).toBeNull();
      expect(await cripto.conferirCodigo(hash, 10, '123456')).toBe(false);
    } finally {
      process.env.RECOVERY_CODE_SECRET = original;
    }
    expect(await cripto.conferirCodigo(hash, 10, '123456')).toBe(true);
    expect(await cripto.conferirCodigo(hash, 11, '123456')).toBe(false); // vinculado ao usuário
  });
});

describe('Auditoria e legado', () => {
  test('auditoria não contém código, reset token, login nem senha', async () => {
    instalarTabelaRecovery();
    instalarUsuario();
    const { userId, resetToken, codigo } = await obterResetToken();
    await request(app).post(RESET).send({ user_id: userId, reset_token: resetToken, password: SENHA_OK });
    await global.aguardarPendentes();
    const tudo = auditorias();
    expect(tudo).toContain('recuperacao_solicitada');
    expect(tudo).toContain('senha_redefinida_recuperacao');
    for (const segredo of [codigo, resetToken, VITIMA.email, VITIMA.cpf, SENHA_OK, userId]) {
      expect(tudo).not.toContain(segredo);
    }
    // Chaves de rate limit também sem e-mail/CPF em claro.
    for (const linha of state.rateLimit.values()) {
      expect(linha.chave).not.toContain('vitima');
      expect(linha.chave).not.toContain(VITIMA.cpf);
    }
  });

  test('JWT de recuperação antigo não redefine senha', async () => {
    instalarTabelaRecovery();
    const res = await request(app).post(RESET)
      .send({ user_id: 10, invite_token: recuperacaoLegada({ id_usuario: 10 }), password: SENHA_OK });
    expect(res.status).toBe(401);
    expect(callsMatching(/SET senha_hash = :senha_hash/)).toHaveLength(0);
  });

  test('JWT de recuperação antigo não autentica PUT /usuarios/:id', async () => {
    const res = await request(app).put('/api/condominio/usuarios/10')
      .send({ invite_token: recuperacaoLegada({ id_usuario: 10 }), password: 'Invasor#1', tipo_perfil_id: 1 });
    expect(res.status).toBe(401);
  });

  test('desafio legado em bcrypt (emitido antes do deploy) continua conferível até expirar', async () => {
    const bcrypt = require('bcryptjs');
    const linhas = instalarTabelaRecovery();
    instalarUsuario();
    linhas.push({ id: 900, id_usuario: VITIMA.id, code_hash: await bcrypt.hash('654321', 4), expires_at: new Date(Date.now() + 60000),
      attempts: 0, consumed_at: null, reset_token_hash: null, reset_expires_at: null, reset_used_at: null, created_at: new Date() });
    const res = await request(app).post(VERIFY).send({ user_id: VITIMA.id, code: '654321' });
    expect(res.status).toBe(200);
    expect(crypto.createHash('sha256').update(res.body.reset_token).digest('hex')).toBe(linhas.find((l) => l.id === 900).reset_token_hash);
  });
});
