'use strict';

// /api/login: só e-mail/CPF legítimos, antes da consulta de autenticação
// (auditoria 27/11/2026). Inválido conta no rate limit e é auditado com
// fingerprint, nunca com o valor.

const request = require('supertest');
const app = require('../src/app');
const fakeDb = require('./helpers/fakeDb');
const { fingerprint } = require('../src/helpers/logSeguro');

const { on, callsMatching } = fakeDb._fake;
const consultasAutenticacao = () => callsMatching(/FROM "condominio-bh"\."tb-usuarios" tu/);
const logsAcesso = () => callsMatching(/INSERT INTO "condominio-bh"\.tb_sgw_log_acesso/);
const IP = '203.0.113.20';
const enviar = (corpo) => request(app).post('/api/login').set('X-Client-IP', IP).send(corpo);

describe('Entradas inválidas → 422 antes da autenticação', () => {
  test.each([
    ['objeto', { $ne: null }],
    ['array', ['a@b.com']],
    ['número', 12345678901],
    ['caractere de controle', 'a@b.com\u0000'],
    ['tamanho excessivo', `${'a'.repeat(250)}@b.com`],
    ['sqli que passava no regex antigo', "admin'--@x.com"],
    ['xss que passava no regex antigo', '<svg/onload=alert(1)>@x.com'],
    ['11 dígitos dentro de script', '<script>12345678901</script>'],
    ['CPF com 10 dígitos', '1234567890'],
    ['vazio', '   ']
  ])('login %s', async (_nome, valor) => {
    const res = await enviar({ login: valor, password: 'senha-qualquer-123' });
    expect(res.status).toBe(422);
    expect(consultasAutenticacao()).toHaveLength(0);
    const texto = JSON.stringify(res.body);
    if (typeof valor === 'string' && valor.trim()) expect(texto).not.toContain(valor.trim());
    expect(res.body.errors[0]).not.toHaveProperty('value');
    // A tentativa conta no rate limit e fica auditada sem o conteúdo.
    const [log] = logsAcesso();
    expect(log.replacements.sucesso).toBe(false);
    expect(log.replacements.mensagem).toContain('Entrada inválida no login.');
    // Valor só com caracteres seguros (ex.: CPF incompleto) pode ser gravado; o resto nunca.
    if (typeof valor === 'string' && /[^A-Za-z0-9._%+@-]/.test(valor.trim())) {
      expect(JSON.stringify(log.replacements)).not.toContain(valor.trim());
    }
  });

  test.each([
    ['objeto', { a: 1 }],
    ['vazia', ''],
    ['longa demais', 'x'.repeat(1025)]
  ])('password %s → 422 sem autenticar', async (_nome, password) => {
    const res = await enviar({ login: 'a@b.com', password });
    expect(res.status).toBe(422);
    expect(consultasAutenticacao()).toHaveLength(0);
  });

  test('login malicioso gravado como fingerprint com categoria', async () => {
    await enviar({ login: "admin'--@x.com", password: 'x' });
    const [log] = logsAcesso();
    expect(log.replacements.email_informado).toBe(fingerprint("admin'--@x.com"));
    expect(log.replacements.mensagem).toContain('[suspeito=sqli]');
  });
});

describe('Formatos legítimos continuam aceitos', () => {
  test.each(['morador@exemplo.com.br', 'Nome.Sobrenome+tag@sub.exemplo.com', '12345678901', '123.456.789-01'])('%s chega à autenticação', async (login) => {
    const res = await enviar({ login, password: 'senha-qualquer-123' });
    expect(res.status).not.toBe(422);
    expect(consultasAutenticacao()).toHaveLength(1);
  });
});

describe('Rate limit também para entradas inválidas', () => {
  test('IP já bloqueado recebe 429 mesmo com entrada inválida', async () => {
    on(/FROM "condominio-bh"\.tb_sgw_log_acesso\s+WHERE acao = 'LOGIN'/, () => [{ falhas_login: 0, falhas_ip: 99 }]);
    const res = await enviar({ login: "x'--@x.com", password: 'x' });
    expect(res.status).toBe(429);
    expect(consultasAutenticacao()).toHaveLength(0);
  });

  test('gravação de entradas inválidas limitada a 30 por origem (contador persistente)', async () => {
    for (let i = 0; i < 35; i += 1) {
      await enviar({ login: `<x${i}>@x.com`, password: 'x' });
    }
    expect(logsAcesso()).toHaveLength(30);
    const chaves = callsMatching(/INSERT INTO "condominio-bh"\.tb_rate_limit/).map((c) => c.replacements.chave);
    expect(chaves).toContain(`log-login-invalido:ip:${IP}`);
  });
});
