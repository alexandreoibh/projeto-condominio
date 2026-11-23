'use strict';

// Trilha de auditoria de segurança ("condominio-bh".tb_auditoria_seguranca,
// migration 20261123000001). Best effort: falha ao gravar nunca quebra o fluxo
// de negócio. Nunca registrar senhas, tokens, certificados ou segredos.

const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { ipEfetivo } = require('./ipCliente');

const CHAVES_PROIBIDAS = /senha|password|token|secret|segredo|certificado|chave_privada|hash/i;

function _sanitizar(valor, profundidade = 0) {
  if (valor === null || valor === undefined) return valor;
  if (profundidade > 4) return '[...]';
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => _sanitizar(v, profundidade + 1));
  if (typeof valor === 'object') {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      saida[chave] = CHAVES_PROIBIDAS.test(chave) ? '[omitido]' : _sanitizar(v, profundidade + 1);
    }
    return saida;
  }
  if (typeof valor === 'string' && valor.length > 500) return `${valor.slice(0, 500)}...`;
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
