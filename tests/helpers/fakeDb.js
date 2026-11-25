'use strict';

// Banco falso para os testes: substitui src/database/postgres (Sequelize).
// Cada teste registra handlers por regex de SQL; o último registrado vence.
// Nenhum teste toca em banco real.

const state = {
  handlers: [],
  usuarios: new Map(), // id -> { id, status, token_version }
  rateLimit: new Map(), // `${chave}|${janela}` -> { chave, janela, contador, atualizado_em }
  relogio: null, // ms fixo para testes de janela/cooldown (null = Date.now())
  calls: []
};

// Testes de integração com PostgreSQL REAL e descartável (tests/pg) podem
// delegar todas as consultas a um Sequelize de verdade. Fora disso, nulo.
let delegado = null;

const _agora = () => (state.relogio === null ? Date.now() : state.relogio);

// tb_rate_limit em memória, com a mesma semântica dos SQL de helpers/rateLimit.js.
// JS é single-thread: cada operação abaixo é atômica, como o upsert no Postgres.
function _rateLimit(sql, r) {
  if (/INSERT INTO "condominio-bh"\.tb_rate_limit/.test(sql) && /to_timestamp\(0\)/.test(sql)) {
    const id = `${r.chave}|0`;
    const atual = state.rateLimit.get(id);
    if (!atual) {
      state.rateLimit.set(id, { chave: r.chave, janela: new Date(0), contador: 1, atualizado_em: _agora() });
      return [{ contador: 1 }];
    }
    if (atual.atualizado_em <= _agora() - Number(r.segundos) * 1000) {
      atual.contador += 1;
      atual.atualizado_em = _agora();
      return [{ contador: atual.contador }];
    }
    return [];
  }
  if (/INSERT INTO "condominio-bh"\.tb_rate_limit/.test(sql)) {
    const tamanho = Number(r.janela_seg) * 1000;
    const janela = new Date(Math.floor(_agora() / tamanho) * tamanho);
    const id = `${r.chave}|${janela.getTime()}`;
    const atual = state.rateLimit.get(id) || { chave: r.chave, janela, contador: 0, atualizado_em: _agora() };
    atual.contador += 1;
    atual.atualizado_em = _agora();
    state.rateLimit.set(id, atual);
    return [{ contador: atual.contador, janela: atual.janela }];
  }
  if (/UPDATE "condominio-bh"\.tb_rate_limit/.test(sql)) {
    const atual = state.rateLimit.get(`${r.chave}|${new Date(r.janela).getTime()}`);
    if (!atual) return [];
    atual.contador = Math.max(atual.contador - 1, 0);
    return [{ contador: atual.contador }];
  }
  if (/DELETE FROM "condominio-bh"\.tb_rate_limit/.test(sql)) {
    let apagadas = 0;
    for (const [id, linha] of state.rateLimit) {
      if (apagadas >= Number(r.lote)) break;
      if (linha.atualizado_em < _agora() - Number(r.horas) * 3600 * 1000) {
        state.rateLimit.delete(id);
        apagadas += 1;
      }
    }
    return [{ apagadas }];
  }
  return null;
}

function on(regex, fn) {
  state.handlers.push({ regex, fn });
}

function setUsuarioSessao(id, { status = 'ativo', token_version = 0 } = {}) {
  state.usuarios.set(Number(id), { id: Number(id), status, token_version });
}

function reset() {
  state.handlers = [];
  state.usuarios = new Map();
  state.rateLimit = new Map();
  state.relogio = null;
  state.calls = [];
}

function callsMatching(regex) {
  return state.calls.filter((call) => regex.test(call.sql));
}

async function query(sql, options = {}) {
  if (delegado) return delegado.query(sql, options);
  const replacements = options.replacements || {};
  state.calls.push({ sql, options, replacements });

  // Qualquer UPDATE que incremente token_version (sozinho ou junto com a
  // senha, na mesma instrução) altera o estado de sessão do usuário.
  const incrementaVersao = /token_version = COALESCE\(token_version, 0\) \+ 1/.test(sql);
  if (incrementaVersao && /WHERE id = :id(?![_a-z])/.test(sql)) {
    const usuario = state.usuarios.get(Number(replacements.id));
    if (usuario) usuario.token_version += 1;
  }

  for (let i = state.handlers.length - 1; i >= 0; i -= 1) {
    const handler = state.handlers[i];
    if (handler.regex.test(sql)) {
      return handler.fn(replacements, options, sql);
    }
  }

  if (/"condominio-bh"\.tb_rate_limit/.test(sql)) {
    const resultado = _rateLimit(sql, replacements);
    if (resultado !== null) return resultado;
  }

  // Estado de sessão consultado pelo middleware auth (helpers/sessao.js).
  if (/SELECT id, status, token_version FROM "condominio-bh"\."tb-usuarios"/.test(sql)) {
    const usuario = state.usuarios.get(Number(replacements.id));
    return usuario ? [usuario] : [];
  }
  if (/SET token_version = COALESCE\(token_version, 0\) \+ 1/.test(sql)) {
    return [[], 1];
  }

  if (options.type === 'SELECT') {
    return [];
  }
  if (/^\s*INSERT/i.test(sql)) {
    return [[{ id: 1 }], 1];
  }
  return [[], 0];
}

async function transaction() {
  if (delegado) return delegado.transaction();
  const tx = {
    finished: undefined,
    commit: async () => { tx.finished = 'commit'; },
    rollback: async () => { tx.finished = 'rollback'; }
  };
  return tx;
}

module.exports = {
  query,
  transaction,
  authenticate: async () => {},
  // helpers de teste
  _fake: { state, on, reset, setUsuarioSessao, callsMatching, delegarPara: (instancia) => { delegado = instancia; } }
};

