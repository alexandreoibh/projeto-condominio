'use strict';

// Gravação segura em tabelas de log/auditoria (incidente 27/11/2026: payloads
// de SQLi/XSS gravados em tb_sgw_log_acesso). Regra: valor fora do charset
// seguro NÃO é gravado — vai um fingerprint (HMAC) que permite correlacionar
// tentativas repetidas sem guardar o conteúdo. A classificação (xss/sqli) é
// só um rótulo complementar; a proteção real continua sendo consulta
// parametrizada, validação de tipo, autenticação e autorização.

const crypto = require('crypto');
const { getJwtSecret } = require('./segredos');

// Sem < > " ' ` \ e sem caracteres de controle.
const CHARSET_SEGURO = /^[^<>"'`\\\u0000-\u001F\u007F]*$/;

// Chave privada do HMAC: AUDIT_FINGERPRINT_SECRET (>= 32 caracteres, opcional,
// recomendado — não muda quando o JWT_SECRET é rotacionado) ou, na falta dela,
// derivada do JWT_SECRET. Sem a chave, não há como testar e-mails/CPFs por
// dicionário contra o fingerprint gravado.
let _chave = null;
function _chaveFingerprint() {
  if (!_chave) {
    const dedicado = String(process.env.AUDIT_FINGERPRINT_SECRET || '');
    const base = dedicado.length >= 32 ? dedicado : getJwtSecret();
    _chave = crypto.createHmac('sha256', base).update('audit-fp').digest();
  }
  return _chave;
}

function fingerprint(valor) {
  const mac = crypto.createHmac('sha256', _chaveFingerprint()).update(String(valor)).digest('hex');
  return `fp:${mac.slice(0, 16)}`;
}

function classificarSuspeito(valor) {
  const texto = String(valor);
  if (/[\u0000-\u001F\u007F]/.test(texto)) return 'controle';
  if (/<\s*\/?\s*[a-z!?]|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html/i.test(texto)) return 'xss';
  if (/['"`;]|--|\/\*|\b(union|select|insert|update|delete|drop|sleep|pg_sleep|benchmark|waitfor)\b/i.test(texto)) return 'sqli';
  return 'formato';
}

// Devolve { valor, suspeito }: valor pronto para gravar (truncado ou fingerprint).
function valorParaLog(valor, max = 200, charset = CHARSET_SEGURO) {
  if (valor === undefined || valor === null) return { valor: null, suspeito: null };
  const texto = String(valor).trim();
  if (texto === '') return { valor: null, suspeito: null };
  if (charset.test(texto) && CHARSET_SEGURO.test(texto)) {
    return { valor: texto.slice(0, max), suspeito: null };
  }
  return { valor: fingerprint(texto), suspeito: classificarSuspeito(texto) };
}

// Identificador da requisição para correlação (x-vercel-id quando seguro).
function idRequisicao(req) {
  const recebido = String(req?.headers?.['x-vercel-id'] || '');
  if (recebido && /^[A-Za-z0-9:._-]{1,80}$/.test(recebido)) return recebido;
  return crypto.randomUUID();
}

module.exports = { fingerprint, classificarSuspeito, valorParaLog, idRequisicao, CHARSET_SEGURO };
