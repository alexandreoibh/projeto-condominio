'use strict';

// Criptografia do fluxo de recuperação de senha. Tudo deriva de
// RECOVERY_CODE_SECRET (segredo exclusivo do backend, independente de
// JWT_SECRET e do segredo de convite). Sem ele, a recuperação responde 503.
//
// - HMAC do login normalizado: chave de rate limit sem e-mail/CPF em claro.
// - Código: "h1:<nonce>:<mac>", mac = HMAC(nonce:id_usuario:codigo). O nonce
//   é único por desafio, então o hash fica vinculado ao desafio e ao usuário
//   e não serve para descoberta offline sem o segredo.
// - Identificador opaco "rh1.<...>": AES-256-GCM do login normalizado com
//   validade de 15 min. Não expõe dado pessoal; a tag GCM autentica.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const RH1_PREFIXO = 'rh1.';
const RH1_TTL_SEGUNDOS = 15 * 60;
const SENHA_MIN_CARACTERES = 15;
const SENHA_MAX_CARACTERES = 64;
const SENHA_MAX_BYTES = 72; // bcrypt ignora o que passa de 72 bytes

function _erroSemSegredo() {
  const erro = new Error('RECOVERY_CODE_SECRET não configurado.');
  erro.status = 503;
  return erro;
}

function _segredo() {
  const valor = String(process.env.RECOVERY_CODE_SECRET || '').trim();
  if (valor.length < 32) {
    throw _erroSemSegredo();
  }
  return valor;
}

function _subchave(info) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(_segredo()), Buffer.alloc(0), Buffer.from(info), 32));
}

// E-mail em minúsculas; CPF só com os 11 dígitos; outro texto em minúsculas.
function normalizarLogin(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return '';
  if (texto.includes('@')) return texto.toLowerCase();
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length === 11) return digitos;
  return texto.toLowerCase();
}

function hmacLogin(loginNormalizado) {
  return crypto.createHmac('sha256', _subchave('rate-login')).update(String(loginNormalizado)).digest('base64url').slice(0, 43);
}

function hashCodigo(idUsuario, codigo) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const mac = crypto.createHmac('sha256', _subchave('codigo')).update(`${nonce}:${idUsuario}:${codigo}`).digest('base64url');
  return `h1:${nonce}:${mac}`;
}

async function conferirCodigo(armazenado, idUsuario, codigo) {
  const valor = String(armazenado || '');
  if (valor.startsWith('h1:')) {
    const [, nonce, mac] = valor.split(':');
    if (!nonce || !mac) return false;
    const esperado = crypto.createHmac('sha256', _subchave('codigo')).update(`${nonce}:${idUsuario}:${String(codigo || '')}`).digest();
    const recebido = Buffer.from(mac, 'base64url');
    return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
  }
  // Desafios emitidos antes desta versão (bcrypt), válidos por no máximo 10 min.
  if (/^\$2[aby]\$/.test(valor)) {
    return bcrypt.compare(String(codigo || ''), valor);
  }
  return false;
}

function emitirIdentificador(loginNormalizado) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', _subchave('rh1'), iv);
  const payload = JSON.stringify({
    l: String(loginNormalizado),
    exp: Math.floor(Date.now() / 1000) + RH1_TTL_SEGUNDOS,
    n: crypto.randomBytes(8).toString('base64url')
  });
  const corpo = Buffer.concat([cifra.update(payload, 'utf8'), cifra.final()]);
  return RH1_PREFIXO + Buffer.concat([iv, corpo, cifra.getAuthTag()]).toString('base64url');
}

function ehIdentificador(valor) {
  return typeof valor === 'string' && valor.startsWith(RH1_PREFIXO) && /^rh1\.[A-Za-z0-9_-]{40,700}$/.test(valor);
}

// Login normalizado, ou null se inválido, adulterado ou expirado.
function abrirIdentificador(valor) {
  if (!ehIdentificador(valor)) return null;
  try {
    const bruto = Buffer.from(valor.slice(RH1_PREFIXO.length), 'base64url');
    if (bruto.length < 12 + 16 + 1) return null;
    const iv = bruto.subarray(0, 12);
    const tag = bruto.subarray(bruto.length - 16);
    const corpo = bruto.subarray(12, bruto.length - 16);
    const decifra = crypto.createDecipheriv('aes-256-gcm', _subchave('rh1'), iv);
    decifra.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([decifra.update(corpo), decifra.final()]).toString('utf8'));
    if (!payload || typeof payload.l !== 'string' || !Number.isInteger(payload.exp)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.l;
  } catch (error) {
    if (error && error.status === 503) throw error;
    return null;
  }
}

// Política de senha da redefinição (contrato definitivo):
// - mínimo 15 caracteres (code points Unicode), não só espaços;
// - máximo 64 caracteres E máximo 72 bytes UTF-8 (limite do bcrypt: acima
//   disso o restante seria ignorado silenciosamente). Os dois limites valem.
function validarNovaSenha(senha) {
  const texto = String(senha || '');
  const caracteres = [...texto].length;
  if (caracteres < SENHA_MIN_CARACTERES || !texto.trim()) {
    return { ok: false, code: 'WEAK_PASSWORD', message: `A senha deve ter no mínimo ${SENHA_MIN_CARACTERES} caracteres.`, min_length: SENHA_MIN_CARACTERES };
  }
  if (caracteres > SENHA_MAX_CARACTERES || Buffer.byteLength(texto, 'utf8') > SENHA_MAX_BYTES) {
    return {
      ok: false,
      code: 'PASSWORD_TOO_LONG',
      message: `A senha deve ter no máximo ${SENHA_MAX_CARACTERES} caracteres (${SENHA_MAX_BYTES} bytes).`,
      max_length: SENHA_MAX_CARACTERES,
      max_bytes: SENHA_MAX_BYTES
    };
  }
  return { ok: true };
}

// Falha cedo (503) se o segredo não estiver configurado.
function exigirSegredo() {
  _segredo();
}

module.exports = {
  normalizarLogin,
  hmacLogin,
  hashCodigo,
  conferirCodigo,
  emitirIdentificador,
  abrirIdentificador,
  ehIdentificador,
  validarNovaSenha,
  exigirSegredo,
  // Só para testes de separação de chaves (HKDF com info distintos).
  _subchave,
  SENHA_MIN_CARACTERES,
  SENHA_MAX_CARACTERES,
  SENHA_MAX_BYTES,
  RH1_TTL_SEGUNDOS
};
