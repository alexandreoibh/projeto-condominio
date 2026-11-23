'use strict';

const jwt = require('jsonwebtoken');
const fakeDb = require('./fakeDb');

const PERFIL = { ADMIN: 1, MORADOR: 2, SINDICO: 3, SUB_SINDICO: 4, PORTARIA: 5, COLABORADOR: 54 };

// JWT de sessão no mesmo formato do loginController, e registra o usuário
// como ativo no banco falso (consultado pelo middleware auth).
function sessao({ id = 10, perfil = PERFIL.MORADOR, condominio = 1, unidade = null, tv = 0, registrar = true, expiresIn = '1h' } = {}) {
  if (registrar) {
    fakeDb._fake.setUsuarioSessao(id, { status: 'ativo', token_version: tv });
  }
  return jwt.sign(
    {
      id,
      IdPerfil: perfil,
      id_perfil: perfil,
      nome_perfil: 'qualquer',
      email: `u${id}@teste.local`,
      id_condominio: condominio,
      id_unidade: unidade,
      empresa: 'condominio',
      tv
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function convite(payload = {}, opcoes = { expiresIn: '1h' }) {
  return jwt.sign({ id_condominio: 1, email: 'novo@teste.local', flow: 'morador_invite', ...payload }, process.env.SERVICE_INVITE_TOKEN_SECRET, opcoes);
}

// Token de recuperação no formato ANTIGO (o que vazava pelo lookup).
function recuperacaoLegada({ id_usuario = 10, id_condominio = 1 } = {}) {
  return jwt.sign(
    { id_usuario, id_condominio, email: 'vitima@teste.local', flow: 'password_recovery', jti: 'x' },
    process.env.SERVICE_INVITE_TOKEN_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { PERFIL, sessao, convite, recuperacaoLegada };
