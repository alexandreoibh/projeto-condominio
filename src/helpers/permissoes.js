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

// Super-admin da plataforma (incidente 22/11/2026): só um Admin (perfil 1)
// cujo id esteja em SUPERADMIN_USER_IDS (ids separados por vírgula) atua
// entre condomínios, cria Admins e altera configurações globais. Os demais
// Admins ficam restritos ao condomínio do próprio token.
function _idsSuperAdmin() {
  return new Set(
    String(process.env.SUPERADMIN_USER_IDS || '')
      .split(',')
      .map((valor) => Number.parseInt(String(valor).trim(), 10))
      .filter((valor) => Number.isInteger(valor) && valor > 0)
  );
}

function ehSuperAdmin(req) {
  if (!ehAdmin(req)) return false;
  if (req?.authTipo && req.authTipo !== 'sessao') return false;
  const idUsuario = Number.parseInt(req?.idcliente, 10);
  return Number.isInteger(idUsuario) && _idsSuperAdmin().has(idUsuario);
}

// Condomínio em que a requisição pode operar.
// - Super-admin: o id informado (body/query) ou, sem ele, null = todos.
// - Demais: sempre o do token; um id informado diferente é recusado
//   ({ negado: true }).
function escopoCondominio(req, idInformado) {
  const doToken = Number.parseInt(req?.id_condominio, 10);
  const informado = Number.parseInt(idInformado, 10);
  const temInformado = Number.isInteger(informado) && informado > 0;
  if (ehSuperAdmin(req)) {
    return { idCondominio: temInformado ? informado : null, negado: false };
  }
  const tokenOk = Number.isInteger(doToken) && doToken > 0 ? doToken : null;
  if (temInformado && informado !== tokenOk) {
    return { idCondominio: tokenOk, negado: true };
  }
  return { idCondominio: tokenOk, negado: !tokenOk };
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
  // Só super-admin cria/promove Admin; Admin local atribui como Síndico.
  if (alvo === PERFIL.ADMIN) return ehSuperAdmin(req);
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
  if (ehSuperAdmin(req)) return true;
  // Admin local não mexe em outro Admin (só o super-admin).
  if (atual === PERFIL.ADMIN) return alvo !== PERFIL.ADMIN;
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

function exigirSuperAdmin(req, res, next) {
  if (!ehSuperAdmin(req)) {
    return res.status(403).json({ message: 'Acesso restrito ao administrador da plataforma.' });
  }
  return next();
}

module.exports = {
  PERFIL,
  PERFIS_GESTORES,
  idPerfil,
  ehAdmin,
  ehSuperAdmin,
  escopoCondominio,
  ehGestor,
  temPerfil,
  podeAtribuirPerfil,
  podeGerenciarUsuarioComPerfil,
  exigirPerfis,
  exigirGestor,
  exigirAdmin,
  exigirSuperAdmin
};
