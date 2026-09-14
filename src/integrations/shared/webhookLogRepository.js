'use strict';

const { QueryTypes } = require('sequelize');
const postgres = require('../../database/postgres');

/**
 * Grava o payload bruto recebido, ANTES de qualquer tentativa de interpretar
 * o evento — é a auditoria mínima garantida mesmo que o processamento
 * subsequente falhe ou a invocação serverless seja cortada.
 *
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.payloadBruto JSON já serializado (string).
 * @param {string} [params.headersRecebidos] JSON já serializado (string).
 * @param {string} [params.ipOrigem]
 * @returns {Promise<number>} id da linha gravada em tb_webhook_bancario_log.
 */
async function registrar({ provider, payloadBruto, headersRecebidos, ipOrigem }) {
  const [rows] = await postgres.query(
    `INSERT INTO "condominio-bh".tb_webhook_bancario_log
       (provider, payload_bruto, headers_recebidos, ip_origem, status_processamento, recebido_em)
     VALUES (:provider, :payloadBruto, :headersRecebidos, :ipOrigem, 'recebido', NOW())
     RETURNING id`,
    {
      replacements: {
        provider,
        payloadBruto,
        headersRecebidos: headersRecebidos || null,
        ipOrigem: ipOrigem || null,
      },
      type: QueryTypes.INSERT,
    }
  );
  return rows[0].id;
}

/**
 * @param {number} id
 * @param {object} params
 * @param {string} params.status 'processado' | 'ignorado' | 'erro'
 * @param {string} [params.eventoTipo]
 * @param {string} [params.idExterno]
 * @param {number} [params.idCondominio]
 * @param {string} [params.erroDetalhe]
 */
async function marcarProcessado(id, { status, eventoTipo, idExterno, idCondominio, erroDetalhe }) {
  await postgres.query(
    `UPDATE "condominio-bh".tb_webhook_bancario_log
        SET status_processamento = :status,
            evento_tipo = COALESCE(:eventoTipo, evento_tipo),
            id_externo = COALESCE(:idExterno, id_externo),
            id_condominio = COALESCE(:idCondominio, id_condominio),
            erro_detalhe = :erroDetalhe,
            processado_em = NOW()
      WHERE id = :id`,
    {
      replacements: {
        id,
        status,
        eventoTipo: eventoTipo || null,
        idExterno: idExterno || null,
        idCondominio: idCondominio || null,
        erroDetalhe: erroDetalhe || null,
      },
      type: QueryTypes.UPDATE,
    }
  );
}

/**
 * Checa se um evento já foi processado com sucesso, para garantir
 * idempotência (mesmo par provider + id_externo + evento_tipo não deve
 * ser reaplicado).
 */
async function jaProcessado({ provider, idExterno, eventoTipo }) {
  const rows = await postgres.query(
    `SELECT 1
       FROM "condominio-bh".tb_webhook_bancario_log
      WHERE provider = :provider
        AND id_externo = :idExterno
        AND evento_tipo = :eventoTipo
        AND status_processamento = 'processado'
      LIMIT 1`,
    {
      replacements: { provider, idExterno, eventoTipo },
      type: QueryTypes.SELECT,
    }
  );
  return rows.length > 0;
}

module.exports = { registrar, marcarProcessado, jaProcessado };
