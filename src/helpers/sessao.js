'use strict';

// Revogação de sessões por usuário via "condominio-bh"."tb-usuarios".token_version.
// O JWT de login carrega o claim `tv`; o middleware auth compara com o banco.
// Trocar senha, perfil ou status, ou fazer logout, incrementa a versão e
// invalida todos os tokens anteriores daquele usuário.

const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // id_usuario -> { versao, status, expiraEm }

// Antes da migration 20261123000001 a coluna não existe. Nesse caso a checagem
// de versão é ignorada (com aviso), mas a checagem de status continua.
let colunaTokenVersionAusente = false;
let avisoColunaAusente = false;

function _ehErroColunaInexistente(error) {
  const code = error?.original?.code || error?.parent?.code || error?.code;
  return code === '42703';
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
  if (!colunaTokenVersionAusente) {
    try {
      const rows = await postgres.query(
        `SELECT id, status, token_version FROM "condominio-bh"."tb-usuarios" WHERE id = :id LIMIT 1`,
        { replacements: { id }, type: QueryTypes.SELECT }
      );
      row = rows && rows[0] ? rows[0] : null;
    } catch (error) {
      if (!_ehErroColunaInexistente(error)) {
        throw error;
      }
      colunaTokenVersionAusente = true;
      if (!avisoColunaAusente) {
        avisoColunaAusente = true;
        console.warn('[sessao] Coluna token_version ausente — rode a migration 20261123000001.');
      }
    }
  }

  if (colunaTokenVersionAusente) {
    const rows = await postgres.query(
      `SELECT id, status FROM "condominio-bh"."tb-usuarios" WHERE id = :id LIMIT 1`,
      { replacements: { id }, type: QueryTypes.SELECT }
    );
    row = rows && rows[0] ? { ...rows[0], token_version: null } : null;
  }

  if (!row) {
    cache.delete(id);
    return { existe: false, versao: null, status: null, expiraEm: agora + CACHE_TTL_MS };
  }

  const estado = {
    existe: true,
    versao:
      row.token_version === null || row.token_version === undefined
        ? null
        : Number.parseInt(row.token_version, 10) || 0,
    status: String(row.status || '').trim().toLowerCase(),
    expiraEm: agora + CACHE_TTL_MS
  };
  cache.set(id, estado);
  return estado;
}

async function lerTokenVersion(idUsuario) {
  const estado = await lerEstadoSessao(idUsuario, { usarCache: false });
  return estado && estado.versao !== null ? estado.versao : 0;
}

async function incrementarTokenVersion(idUsuario, { transaction = null } = {}) {
  const id = Number.parseInt(idUsuario, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }
  cache.delete(id);
  if (colunaTokenVersionAusente) {
    return;
  }
  try {
    await postgres.query(
      `UPDATE "condominio-bh"."tb-usuarios"
          SET token_version = COALESCE(token_version, 0) + 1
        WHERE id = :id`,
      { replacements: { id }, type: QueryTypes.UPDATE, transaction }
    );
  } catch (error) {
    if (_ehErroColunaInexistente(error)) {
      colunaTokenVersionAusente = true;
      return;
    }
    throw error;
  }
}

function invalidarCacheSessao(idUsuario) {
  const id = Number.parseInt(idUsuario, 10);
  if (Number.isInteger(id)) {
    cache.delete(id);
  }
}

function _resetParaTestes() {
  cache.clear();
  colunaTokenVersionAusente = false;
  avisoColunaAusente = false;
}

module.exports = {
  lerEstadoSessao,
  lerTokenVersion,
  incrementarTokenVersion,
  invalidarCacheSessao,
  _resetParaTestes
};
