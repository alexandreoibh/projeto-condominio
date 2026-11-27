'use strict';

// Trilha de auditoria de segurança ("condominio-bh".tb_auditoria_seguranca,
// migration 20261123000001). Best effort: falha ao gravar nunca quebra o fluxo
// de negócio. Nunca registrar senhas, tokens, certificados ou segredos.

const { QueryTypes } = require('sequelize');
const { fingerprint, classificarSuspeito, CHARSET_SEGURO } = require('./logSeguro');
const postgres = require('../database/postgres');
const { ipEfetivo } = require('./ipCliente');

// Chaves cujo valor nunca é gravado (comparação sem diferenciar maiúsculas).
const CHAVES_PROIBIDAS = /senha|password|passwd|token|secret|segredo|certificado|chave|private|hash|authorization|cookie|jwt|api[_-]?key|credencial|credential|client_id/i;

// Valores com formato de segredo são omitidos mesmo sob uma chave "inocente"
// (ex.: detalhes: { valor: '<jwt>' }).
const VALORES_PROIBIDOS = [
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/, // JWT
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/, // hash bcrypt
  /vercel_blob_rw_[A-Za-z0-9_]+/i, // token do Vercel Blob
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/i, // header Authorization
  /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/ // PEM
];

function _valorSensivel(texto) {
  return VALORES_PROIBIDOS.some((regex) => regex.test(texto));
}

function _sanitizar(valor, profundidade = 0) {
  if (valor === null || valor === undefined) return valor;
  if (profundidade > 4) return '[...]';
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => _sanitizar(v, profundidade + 1));
  if (Buffer.isBuffer(valor)) return '[omitido]';
  if (typeof valor === 'object') {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      saida[chave] = CHAVES_PROIBIDAS.test(chave) ? '[omitido]' : _sanitizar(v, profundidade + 1);
    }
    return saida;
  }
  if (typeof valor === 'string') {
    if (_valorSensivel(valor)) return '[omitido]';
    // Fora do charset seguro (<, >, aspas, controle): fingerprint, nunca o
    // conteúdo — evita gravar payloads de XSS/SQLi (incidente 27/11/2026).
    if (!CHARSET_SEGURO.test(valor)) return `${fingerprint(valor)} [suspeito=${classificarSuspeito(valor)}]`;
    if (valor.length > 200) return `${valor.slice(0, 200)}...`;
  }
  return valor;
}

// IP do cliente: via proxy confiável (back-cond.php), o IP informado por ele;
// senão, req.ip. Pode ser null (proxy que não informou o cliente).
function ipDaRequisicao(req) {
  if (!req) return null;
  const { ip } = ipEfetivo(req);
  return ip ? ip.slice(0, 64) : null;
}

async function registrarAuditoria({
  req = null,
  acao,
  entidade = null,
  entidadeId = null,
  idCondominio = null,
  idUsuarioAtor = null,
  detalhes = null
}) {
  // Sem transaction de propósito: um INSERT que falhe dentro de uma transação
  // do Postgres aborta a transação inteira. Chamar depois do commit.
  try {
    const ator = idUsuarioAtor ?? (req ? Number.parseInt(req.idcliente, 10) || null : null);
    const condominio = idCondominio ?? (req ? Number.parseInt(req.id_condominio, 10) || null : null);
    await postgres.query(
      `INSERT INTO "condominio-bh".tb_auditoria_seguranca
         (id_usuario_ator, id_condominio, acao, entidade, entidade_id, detalhes, ip, created_at)
       VALUES (:ator, :condominio, :acao, :entidade, :entidade_id, :detalhes, :ip, NOW())`,
      {
        replacements: {
          ator,
          condominio,
          acao: String(acao).slice(0, 80),
          entidade: entidade ? String(entidade).slice(0, 80) : null,
          entidade_id: entidadeId === null || entidadeId === undefined ? null : String(entidadeId).slice(0, 80),
          detalhes: detalhes ? JSON.stringify(_sanitizar(detalhes)) : null,
          ip: ipDaRequisicao(req)
        },
        type: QueryTypes.INSERT
      }
    );
  } catch (error) {
    console.error(`[auditoria] Falha ao registrar ${acao}:`, error?.message);
  }
}

module.exports = { registrarAuditoria, ipDaRequisicao, _sanitizar };
