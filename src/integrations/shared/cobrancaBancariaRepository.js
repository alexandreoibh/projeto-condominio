'use strict';

const { QueryTypes } = require('sequelize');
const postgres = require('../../database/postgres');
const { despacharEmail } = require('../../service/emailDispatchService');

/**
 * Busca os dados da receita/unidade/condomínio e dispara os e-mails de
 * "cobrança paga" para moradores da unidade e para síndico/sub-síndico do
 * condomínio. Chamado a partir de aplicarSituacao — portanto cobre webhook
 * (qualquer provider: Inter, Itaú, Bradesco, futuros) e o cron de
 * reconciliação, sem duplicar lógica em nenhum dos dois call-sites. Cada
 * disparo é isolado em try/catch: falha de e-mail nunca deve reverter ou
 * mascarar a baixa financeira, que já foi aplicada com sucesso antes desta
 * chamada.
 *
 * @param {object} cobranca Linha de tb_fin_cobranca_bancaria (já com a baixa aplicada).
 */
async function _notificarCobrancaPaga(cobranca) {
  let receita;
  try {
    [receita] = await postgres.query(
      `SELECT r.id, r.id_unidade, r.valor, r.competencia, r.data_vencimento,
              tcu.unidades_bloco AS unidade_texto,
              COALESCE(tcu.bloco::text, '') AS bloco,
              c.nome AS condominio_nome
         FROM "condominio-bh".tb_fin_receitas r
         LEFT JOIN "condominio-bh".tb_condominios_unidades tcu
           ON tcu.id = r.id_unidade AND tcu.id_condominio = r.id_condominio
         LEFT JOIN "condominio-bh"."tb-condominios" c ON c.id = r.id_condominio
        WHERE r.id = :idReceita AND r.id_condominio = :idCondominio`,
      { replacements: { idReceita: cobranca.id_receita, idCondominio: cobranca.id_condominio }, type: QueryTypes.SELECT }
    );
  } catch (err) {
    console.error(`[cobrancaBancariaRepository] Erro ao buscar dados da receita id=${cobranca.id_receita} para notificação de pagamento:`, err?.message);
    return;
  }

  if (!receita) return;

  const dadosCobranca = {
    condominio_nome: receita.condominio_nome,
    unidade_texto: receita.unidade_texto,
    bloco: receita.bloco,
    valor: cobranca.valor,
    competencia: receita.competencia,
    data_pagamento: new Date().toISOString(),
  };

  try {
    const moradoresUnidade = receita.id_unidade
      ? await postgres.query(
          `SELECT tu.nome, tu.email
             FROM "condominio-bh"."tb-usuarios" tu
            WHERE tu.id_unidade_predio = :id_unidade
              AND tu.id_condominio = :id_condominio
              AND tu.status IN ('ativo', 'Ativo')
            ORDER BY tu.created_at ASC`,
          { replacements: { id_unidade: receita.id_unidade, id_condominio: cobranca.id_condominio }, type: QueryTypes.SELECT }
        )
      : [];

    const emailsMoradores = moradoresUnidade.map((m) => m.email).filter(Boolean);
    if (emailsMoradores.length > 0) {
      await despacharEmail({
        _ref: `cobranca_paga_morador_${cobranca.id}`,
        template: 'cobranca_paga_morador',
        emails: emailsMoradores,
        cobranca: dadosCobranca,
      });
    }
  } catch (err) {
    console.error(`[cobrancaBancariaRepository] Erro ao notificar moradores do pagamento da cobrança id=${cobranca.id}:`, err?.message);
  }

  try {
    const gestores = await postgres.query(
      `SELECT email FROM "condominio-bh"."tb-usuarios"
        WHERE id_condominio = :id_condominio
          AND COALESCE(tipo_perfil_id::text, '0') IN ('3', '4')
          AND COALESCE(status, '') IN ('ativo', 'Ativo')
          AND email IS NOT NULL AND email <> ''`,
      { replacements: { id_condominio: cobranca.id_condominio }, type: QueryTypes.SELECT }
    );

    const emailsGestores = gestores.map((g) => g.email).filter(Boolean);
    if (emailsGestores.length > 0) {
      await despacharEmail({
        _ref: `cobranca_paga_sindico_${cobranca.id}`,
        template: 'cobranca_paga_sindico',
        emails: emailsGestores,
        cobranca: { ...dadosCobranca, provider: cobranca.provider },
      });
    }
  } catch (err) {
    console.error(`[cobrancaBancariaRepository] Erro ao notificar síndico do pagamento da cobrança id=${cobranca.id}:`, err?.message);
  }
}

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

    // Notificação por e-mail (morador + síndico, conteúdos distintos) —
    // roda para qualquer provider bancário, pois aplicarSituacao já é o
    // ponto único de baixa financeira chamado tanto pelo webhook quanto
    // pelo cron de reconciliação. Isolada em função própria para não
    // poluir esta função com lógica de resolução de destinatários.
    await _notificarCobrancaPaga(cobranca);

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
