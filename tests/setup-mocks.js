'use strict';

// Mocks globais: banco, cron, e-mail, push, blob e waitUntil. Nenhuma chamada
// externa real acontece nos testes (sem banco, sem e-mail, sem Banco Inter).

jest.mock('../src/database/postgres', () => require('./helpers/fakeDb'));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

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

const fakeDb = require('./helpers/fakeDb');
const sessao = require('../src/helpers/sessao');

beforeEach(() => {
  fakeDb._fake.reset();
  sessao._resetParaTestes();
  global.__pendentes = [];
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
