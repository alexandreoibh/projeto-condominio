'use strict';

const { QueryTypes } = require('sequelize');
const postgres = require('../../database/postgres');

/**
 * Aplica uma mudança de situação (vinda do webhook ou de uma reconciliação
 * ativa) em tb_fin_cobranca_bancaria + tb_fin_receitas — extraído de
 * routes/webhookBancario.js para ser reaproveitado também pelo cron de
 * reconciliação (task/reconciliarCobrancasBancarias.js), evitando duplicar
 * a lógica de baixa em dois lugares.
 *
 * @param {object} cobranca Linha atual de tb_fin_cobranca_bancaria.
 * @param {'pago'|'cancelado'|'em_aberto'|'atrasado'|'desconhecida'} situacaoNormalizada
 * @returns {Promise<boolean>} true se alguma atualização foi aplicada.
 */
async function aplicarSituacao(cobranca, situacaoNormalizada) {
  if (situacaoNormalizada === 'pago' && cobranca.situacao !== 'paga') {
    await postgres.query(
      `UPDATE "condominio-bh".tb_fin_cobranca_bancaria
          SET situacao = 'paga', data_pagamento = NOW(), valor_pago = valor, updated_at = NOW()
        WHERE id = :id`,
      { replacements: { id: cobranca.id }, type: QueryTypes.UPDATE }
    );

    // Reaproveita o mesmo padrão de baixa manual já usado em
    // financeiroController.atualizarReceita (UPDATE direto em
    // tb_fin_receitas com situacao='pago' + data_pagamento).
    await postgres.query(
      `UPDATE "condominio-bh".tb_fin_receitas
          SET situacao = 'pago', data_pagamento = NOW(), updated_at = NOW()
        WHERE id = :idReceita AND id_condominio = :idCondominio`,
      { replacements: { idReceita: cobranca.id_receita, idCondominio: cobranca.id_condominio }, type: QueryTypes.UPDATE }
    );
    return true;
  }

  if (situacaoNormalizada === 'cancelado' && cobranca.situacao !== 'cancelada') {
    await postgres.query(
      `UPDATE "condominio-bh".tb_fin_cobranca_bancaria
          SET situacao = 'cancelada', updated_at = NOW()
        WHERE id = :id`,
      { replacements: { id: cobranca.id }, type: QueryTypes.UPDATE }
    );
    return true;
  }

  return false;
}

module.exports = { aplicarSituacao };
