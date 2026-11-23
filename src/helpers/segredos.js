'use strict';

// Segredos obrigatórios. Não existe mais fallback fixo no código: sem a
// variável de ambiente o processo não sobe (fail closed). Em NODE_ENV=test os
// testes definem os valores em tests/setup.js.

function _exigir(nome, valor) {
  const texto = valor === undefined || valor === null ? '' : String(valor).trim();
  if (!texto) {
    throw new Error(
      `[segredos] Variável de ambiente ${nome} não configurada. Defina-a antes de iniciar o servidor.`
    );
  }
  return texto;
}

function getJwtSecret() {
  return _exigir('JWT_SECRET', process.env.JWT_SECRET);
}

function getInviteTokenSecret() {
  const valor = process.env.SERVICE_INVITE_TOKEN_SECRET || process.env.INVITE_TOKEN_SECRET;
  return _exigir('SERVICE_INVITE_TOKEN_SECRET (ou INVITE_TOKEN_SECRET)', valor);
}

let avisoSegredoCompartilhado = false;
function validarSegredosNaInicializacao() {
  const jwtSecret = getJwtSecret();
  const inviteSecret = getInviteTokenSecret();
  if (jwtSecret === inviteSecret && !avisoSegredoCompartilhado) {
    avisoSegredoCompartilhado = true;
    console.warn(
      '[segredos] JWT_SECRET e SERVICE_INVITE_TOKEN_SECRET são iguais. Use segredos distintos.'
    );
  }
}

module.exports = {
  getJwtSecret,
  getInviteTokenSecret,
  validarSegredosNaInicializacao
};
