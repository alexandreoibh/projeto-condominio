'use strict';

// Revogação de sessões por usuário via "condominio-bh"."tb-usuarios".token_version.
// O JWT de login carrega o claim `tv`; o middleware auth compara com o banco.
// Trocar senha, perfil, status, e-mail ou CPF, ou fazer logout, incrementa a
// versão e invalida todos os tokens anteriores daquele usuário.
//
// Fail closed (incidente 22/11/2026): sem a coluna token_version não há como
// revogar sessões, então a validação falha (503) em vez de ignorar a checagem.

const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // id_usuario -> { versao, status, expiraEm }

function _ehErroColunaInexistente(error) {
  const code = error?.original?.code || error?.parent?.code || error?.code;
  return code === '42703';
}

function _erroColunaAusente() {
  console.error('[sessao] Coluna token_version ausente — rode a migration 20261123000001.');
  const erro = new Error('Revogação de sessão indisponível.');
  erro.status = 503;
  return erro;
}

async function lerEstadoSessao(idUsuario, { usarCache = true } = {}) {
  const id = Number.parseInt(idUsuario, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const agora = Date.now();
  if (usarCache) {
    const hit = cache.get(id);
    if (hit && hit.expiraEm > agora) {
      return hit;
    }
  }

  let row = null;
  try {
    const rows = await postgres.query(
      `SELECT id, status, token_version FROM "condominio-bh"."tb-usuarios" WHERE id = :id LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    row = rows && rows[0] ? rows[0] : null;
  } catch (error) {
    if (_ehErroColunaInexistente(error)) {
      throw _erroColunaAusente();
    }
    throw error;
  }

  if (!row) {
    cache.delete(id);
    return { existe: false, versao: null, status: null, expiraEm: agora + CACHE_TTL_MS };
  }

  const versao = Number.parseInt(row.token_version, 10);
  const estado = {
    existe: true,
    versao: Number.isInteger(versao) ? versao : 0,
    status: String(row.status || '').trim().toLowerCase(),
    expiraEm: agora + CACHE_TTL_MS
  };
  cache.set(id, estado);
  return estado;
}

async function lerTokenVersion(idUsuario) {
  const estado = await lerEstadoSessao(idUsuario, { usarCache: false });
  return estado && Number.isInteger(estado.versao) ? estado.versao : 0;
}

// Com `transaction`, o incremento entra na mesma transação da alteração
// (senha, perfil etc.): ou as duas coisas acontecem, ou nenhuma. Nesse caso
// chame invalidarCacheSessao(id) depois do commit.
async function incrementarTokenVersion(idUsuario, { transaction = null } = {}) {
  const id = Number.parseInt(idUsuario, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }
  cache.delete(id);
  try {
    await postgres.query(
      `UPDATE "condominio-bh"."tb-usuarios"
          SET token_version = COALESCE(token_version, 0) + 1
        WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.UPDATE, transaction }
    );
  } catch (error) {
    if (_ehErroColunaInexistente(error)) {
      throw _erroColunaAusente();
    }
    throw error;
  }
  cache.delete(id);
}

function invalidarCacheSessao(idUsuario) {
  const id = Number.parseInt(idUsuario, 10);
  if (Number.isInteger(id)) {
    cache.delete(id);
  }
}

function _resetParaTestes() {
  cache.clear();
}

module.exports = {
  lerEstadoSessao,
  lerTokenVersion,
  incrementarTokenVersion,
  invalidarCacheSessao,
  _resetParaTestes
};
