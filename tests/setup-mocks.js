'use strict';

// Mocks globais: banco, cron, e-mail, push, blob e waitUntil. Nenhuma chamada
// externa real acontece nos testes (sem banco, sem e-mail, sem Banco Inter).

jest.mock('../src/database/postgres', () => require('./helpers/fakeDb'));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

// Sem rede nos testes: node-fetch delega ao fetch global, que por padrão
// falha (cada teste que precisa de HTTP substitui global.fetch por um mock).
jest.mock('node-fetch', () => (...args) => global.fetch(...args));

jest.mock('../src/service/emailDispatchService', () => {
  const despacharEmail = jest.fn(async () => ({ ok: true, status: 200 }));
  return { despacharEmail, despacharEmailReserva: despacharEmail };
});

jest.mock('../src/service/pushNotificationService', () => new Proxy({}, {
  get: (alvo, prop) => {
    if (!alvo[prop]) alvo[prop] = jest.fn(async () => ({}));
    return alvo[prop];
  }
}));

jest.mock('@vercel/blob', () => ({
  put: jest.fn(async (caminho) => ({ url: `https://teststore.private.blob.vercel-storage.com/${caminho}` })),
  del: jest.fn(async () => ({}))
}));

// waitUntil: guarda as promises para os testes poderem aguardá-las.
global.__pendentes = [];
jest.mock('@vercel/functions', () => ({
  waitUntil: (promessa) => { global.__pendentes.push(Promise.resolve(promessa).catch(() => {})); }
}));
global.aguardarPendentes = async () => {
  const pendentes = global.__pendentes.splice(0);
  await Promise.all(pendentes);
};

// axios (legado em src/task/acoes_tela.js): nenhuma requisição real.
jest.mock('axios', () => {
  const bloquear = async (url) => { throw new Error(`Rede bloqueada nos testes (axios): ${String(url).split('?')[0]}`); };
  const instancia = { get: bloquear, post: bloquear, put: bloquear, patch: bloquear, delete: bloquear, request: bloquear };
  return { ...instancia, create: () => instancia, default: instancia };
}, { virtual: true });

// http/https nativos (clientes do Inter, Itaú e Bradesco usam https.request).
// https: sempre bloqueado. http: só loopback, que é o que o supertest usa.
const http = require('http');
const https = require('https');
const HOSTS_LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '']);

function _hostDaRequisicao(args) {
  const [primeiro] = args;
  if (typeof primeiro === 'string' || primeiro instanceof URL) {
    try { return new URL(String(primeiro)).hostname; } catch (_) { return String(primeiro); }
  }
  if (primeiro && typeof primeiro === 'object') {
    return String(primeiro.hostname || primeiro.host || '').split(':')[0];
  }
  return '';
}

function _bloquearRede(modulo, nomeModulo, { permitirLoopback }) {
  if (modulo.__redeBloqueada) return;
  for (const metodo of ['request', 'get']) {
    const original = modulo[metodo];
    modulo[metodo] = function requisicaoBloqueada(...args) {
      const host = _hostDaRequisicao(args);
      if (permitirLoopback && HOSTS_LOOPBACK.has(host)) {
        return original.apply(this, args);
      }
      throw new Error(`Rede bloqueada nos testes (${nomeModulo}.${metodo}): ${host || '?'}`);
    };
  }
  modulo.__redeBloqueada = true;
}

_bloquearRede(https, 'https', { permitirLoopback: false });
_bloquearRede(http, 'http', { permitirLoopback: true });

const fakeDb = require('./helpers/fakeDb');
const sessao = require('../src/helpers/sessao');

beforeEach(() => {
  fakeDb._fake.reset();
  sessao._resetParaTestes();
  global.__pendentes = [];
  global.fetch = jest.fn(async (url) => {
    throw new Error(`Rede bloqueada nos testes: ${String(url).split('?')[0]}`);
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Restaura só os spies de console (restoreAllMocks também zeraria os mocks
  // de módulo acima).
  for (const metodo of ['log', 'warn', 'error']) {
    if (console[metodo] && console[metodo].mockRestore) console[metodo].mockRestore();
  }
});
