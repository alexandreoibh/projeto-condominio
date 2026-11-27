'use strict';

// Auditoria de login/segurança sem payload malicioso (auditoria 27/11/2026, F4).

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { _sanitizar } = require('../src/helpers/auditoria');
const { valorParaLog, fingerprint } = require('../src/helpers/logSeguro');

const { on, callsMatching } = fakeDb._fake;
const logsAcesso = () => callsMatching(/INSERT INTO "condominio-bh"\.tb_sgw_log_acesso/);
// Vetores que passam pelo validador de /api/login (regex de e-mail sem espaço
// e qualquer string com 11 dígitos) e por isso chegavam ao log.
const XSS = '<svg/onload=alert(1)>@x.com';
const SQLI = "admin'--@x.com";
const XSS_UA = '<script>alert(document.cookie)</script>';

const tentarLogin = (corpo, ua) => {
  const req = request(app).post('/api/login');
  if (ua) req.set('User-Agent', ua);
  return req.send(corpo);
};

describe('tb_sgw_log_acesso não guarda payload malicioso', () => {
  test.each([
    ['sqli', SQLI],
    ['xss', XSS]
  ])('login com %s é gravado como fingerprint com categoria', async (categoria, payload) => {
    await tentarLogin({ login: payload, password: 'senha-qualquer-123' });
    const logs = logsAcesso();
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      const texto = JSON.stringify(log.replacements);
      expect(texto).not.toContain(payload);
      expect(texto).not.toContain('senha-qualquer-123');
      expect(log.replacements.email_informado).toBe(fingerprint(payload.toLowerCase()));
      expect(log.replacements.mensagem).toContain(`[suspeito=${categoria}]`);
      expect(log.replacements.mensagem).toMatch(/\[rota=\/api\/login\] \[req=[A-Za-z0-9:._-]+\]/);
    }
  });

  test('User-Agent e campos declarados com script viram fingerprint; e-mail válido é preservado', async () => {
    await request(app).post('/api/login')
      .set('User-Agent', XSS_UA)
      .set('X-Client-Device', '"><img src=x onerror=alert(1)>')
      .send({ login: 'Morador@Exemplo.com', password: 'senha-qualquer-123', ip: "1.1.1.1' OR 1=1" });
    const [log] = logsAcesso();
    const texto = JSON.stringify(log.replacements);
    expect(texto).not.toMatch(/<script|onerror|<img|OR 1=1/);
    expect(log.replacements.user_agent).toBe(fingerprint(XSS_UA));
    expect(log.replacements.email_informado).toBe('morador@exemplo.com');
    expect(log.replacements.mensagem).toContain('[suspeito=');
  });

  test('campos longos são truncados', async () => {
    const uaLongo = `Mozilla/5.0 ${'a'.repeat(1000)}`;
    await tentarLogin({ login: 'a@b.com', password: 'senha-qualquer-123' }, uaLongo);
    const [log] = logsAcesso();
    expect(log.replacements.user_agent.length).toBeLessThanOrEqual(255);
    expect(log.replacements.mensagem.length).toBeLessThanOrEqual(1000);
  });

  test('rate limit de login compara pelo mesmo fingerprint gravado', async () => {
    await tentarLogin({ login: SQLI, password: 'senha-qualquer-123' });
    const [consulta] = callsMatching(/FROM "condominio-bh"\.tb_sgw_log_acesso\s+WHERE acao = 'LOGIN'/);
    expect(consulta.replacements.login).toBe(fingerprint(SQLI.toLowerCase()));
    expect(JSON.stringify(consulta.replacements)).not.toContain(SQLI);
  });

  test('tentativas já bloqueadas só são gravadas até o limite por IP da janela', async () => {
    on(/FROM "condominio-bh"\.tb_sgw_log_acesso\s+WHERE acao = 'LOGIN'/, () => [{ falhas_login: 0, falhas_ip: 99 }]);
    for (let i = 0; i < 35; i += 1) {
      const res = await request(app).post('/api/login').set('X-Client-IP', '203.0.113.9').send({ login: 'a@b.com', password: 'senha-qualquer-123' });
      expect(res.status).toBe(429);
    }
    expect(logsAcesso()).toHaveLength(30);
  });

  test('sem IP confiável (proxy não informou o cliente): balde persistente por proxy, 429 após o limite', async () => {
    const statuses = [];
    for (let i = 0; i < 32; i += 1) {
      // Loopback é proxy confiável; sem X-Client-IP não há IP efetivo.
      const res = await request(app).post('/api/login')
        .send({ login: 'a@b.com', password: 'senha-qualquer-123' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
    const chaves = new Set(callsMatching(/INSERT INTO "condominio-bh"\.tb_rate_limit/).map((c) => c.replacements.chave));
    expect([...chaves].filter((c) => c.startsWith('login-proxy-sem-ip:'))).toHaveLength(1);
  });

  test('sem IP confiável, gravação de bloqueados também tem teto (sem "return true")', async () => {
    on(/FROM "condominio-bh"\.tb_sgw_log_acesso\s+WHERE acao = 'LOGIN'/, () => [{ falhas_login: 99, falhas_ip: 0 }]);
    for (let i = 0; i < 35; i += 1) {
      expect((await tentarLogin({ login: 'a@b.com', password: 'senha-qualquer-123' })).status).toBe(429);
    }
    expect(logsAcesso()).toHaveLength(30);
  });
});

describe('fingerprint', () => {
  test('HMAC com chave privada: hash simples do valor não reproduz o fingerprint', () => {
    const crypto = require('crypto');
    const email = 'morador@exemplo.com';
    const fp = fingerprint(email).slice(3);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)).not.toBe(fp);
    expect(crypto.createHmac('sha256', 'chave-errada').update(email).digest('hex').slice(0, 16)).not.toBe(fp);
  });
});

describe('helpers', () => {
  test('valorParaLog: seguro passa truncado; fora do charset vira fingerprint', () => {
    expect(valorParaLog('Chrome 120', 5)).toEqual({ valor: 'Chrom', suspeito: null });
    expect(valorParaLog(XSS)).toEqual({ valor: fingerprint(XSS), suspeito: 'xss' });
    expect(valorParaLog("x' UNION SELECT 1--").suspeito).toBe('sqli');
    expect(valorParaLog('a\u0000b').suspeito).toBe('controle');
    expect(fingerprint(XSS)).toBe(fingerprint(XSS)); // correlação de tentativas repetidas
  });

  test('_sanitizar (tb_auditoria_seguranca) não guarda script nem SQL; limita a 200', () => {
    const saida = _sanitizar({ perfil_ids: [XSS], canais: SQLI, nota: 'x'.repeat(300), senha: 'abc' });
    const texto = JSON.stringify(saida);
    expect(texto).not.toMatch(/<script|OR 1=1/);
    expect(saida.perfil_ids[0]).toMatch(/^fp:[0-9a-f]{16} \[suspeito=xss\]$/);
    expect(saida.nota.length).toBeLessThanOrEqual(203);
    expect(saida.senha).toBe('[omitido]');
  });
});
