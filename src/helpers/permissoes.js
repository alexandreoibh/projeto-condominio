'use strict';

// Autorização por perfil. Usa SEMPRE o id numérico do perfil vindo do JWT
// (req.IdPerfil), nunca o nome (nome_perfil/role), que deriva da coluna
// editável "tb-usuarios".tipo.

const PERFIL = Object.freeze({
  ADMIN: 1,
  MORADOR: 2,
  SINDICO: 3,
  SUB_SINDICO: 4,
  PORTARIA: 5,
  COLABORADOR: 54
});

const PERFIS_GESTORES = Object.freeze([PERFIL.ADMIN, PERFIL.SINDICO, PERFIL.SUB_SINDICO]);

function idPerfil(req) {
  const valor = Number.parseInt(req?.IdPerfil, 10);
  return Number.isInteger(valor) ? valor : null;
}

function ehAdmin(req) {
  return idPerfil(req) === PERFIL.ADMIN;
}

function ehGestor(req) {
  return PERFIS_GESTORES.includes(idPerfil(req));
}

function temPerfil(req, ...ids) {
  const atual = idPerfil(req);
  return atual !== null && ids.flat().includes(atual);
}

// Perfis que o usuário autenticado pode atribuir a outros usuários.
// Mesma hierarquia de listarPerfis: Admin atribui tudo; Síndico tudo menos
// Admin; Sub-Síndico tudo menos Admin e Síndico; demais perfis não atribuem.
function podeAtribuirPerfil(req, idPerfilAlvo) {
  const alvo = Number.parseInt(idPerfilAlvo, 10);
  if (!Number.isInteger(alvo)) {
    return false;
  }
  const atual = idPerfil(req);
  if (atual === PERFIL.ADMIN) return true;
  if (atual === PERFIL.SINDICO) return alvo !== PERFIL.ADMIN;
  if (atual === PERFIL.SUB_SINDICO) return alvo !== PERFIL.ADMIN && alvo !== PERFIL.SINDICO;
  return false;
}

// Pode o autenticado gerenciar (editar dados administrativos de) um usuário
// que hoje tem o perfil `idPerfilAlvoAtual`?
function podeGerenciarUsuarioComPerfil(req, idPerfilAlvoAtual) {
  const alvo = Number.parseInt(idPerfilAlvoAtual, 10);
  const atual = idPerfil(req);
  if (atual === PERFIL.ADMIN) return true;
  if (!ehGestor(req)) return false;
  // Gestores não mexem em Admin; Sub-Síndico também não mexe em Síndico.
  if (alvo === PERFIL.ADMIN) return false;
  if (atual === PERFIL.SUB_SINDICO && alvo === PERFIL.SINDICO) return false;
  return true;
}

function exigirPerfis(...ids) {
  const permitidos = ids.flat();
  return (req, res, next) => {
    if (!temPerfil(req, permitidos)) {
      return res.status(403).json({ message: 'Acesso negado para o seu perfil.' });
    }
    return next();
  };
}

const exigirGestor = exigirPerfis(PERFIS_GESTORES);
const exigirAdmin = exigirPerfis(PERFIL.ADMIN);

module.exports = {
  PERFIL,
  PERFIS_GESTORES,
  idPerfil,
  ehAdmin,
  ehGestor,
  temPerfil,
  podeAtribuirPerfil,
  podeGerenciarUsuarioComPerfil,
  exigirPerfis,
  exigirGestor,
  exigirAdmin
};
