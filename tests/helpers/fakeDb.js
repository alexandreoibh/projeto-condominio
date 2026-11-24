'use strict';

// Banco falso para os testes: substitui src/database/postgres (Sequelize).
// Cada teste registra handlers por regex de SQL; o último registrado vence.
// Nenhum teste toca em banco real.

const state = {
  handlers: [],
  usuarios: new Map(), // id -> { id, status, token_version }
  calls: []
};

function on(regex, fn) {
  state.handlers.push({ regex, fn });
}

function setUsuarioSessao(id, { status = 'ativo', token_version = 0 } = {}) {
  state.usuarios.set(Number(id), { id: Number(id), status, token_version });
}

function reset() {
  state.handlers = [];
  state.usuarios = new Map();
  state.calls = [];
}

function callsMatching(regex) {
  return state.calls.filter((call) => regex.test(call.sql));
}

async function query(sql, options = {}) {
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
  _fake: { state, on, reset, setUsuarioSessao, callsMatching }
};

