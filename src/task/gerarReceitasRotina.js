const cron = require('node-cron');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

function calcularVencimentoRotina(diaVencimento, ano, mes) {
  const ultimoDiaMes = new Date(ano, mes, 0).getDate();
  const diaNumerico = Number.parseInt(diaVencimento, 10);
  const dia = diaVencimento === 'ultimo_dia'
    ? ultimoDiaMes
    : Math.min(Number.isNaN(diaNumerico) ? ultimoDiaMes : diaNumerico, ultimoDiaMes);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

async function gerarReceitasRotina() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const primeiroDiaMes = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const competenciaAtual = `${ano}-${String(mes).padStart(2, '0')}`;

  let rotinas;
  try {
    rotinas = await postgres.query(
      `SELECT id, id_condominio, dia_vencimento, data_fim
         FROM "condominio-bh".tb_fin_receita_rotina
        WHERE ativo = true`,
      { type: QueryTypes.SELECT }
    );
  } catch (err) {
    console.error('[gerarReceitasRotina] Erro ao buscar rotinas:', err?.message);
    return;
  }

  if (!rotinas || rotinas.length === 0) {
    console.log('[gerarReceitasRotina] Nenhuma rotina ativa.');
    return;
  }

  for (const rotina of rotinas) {
    try {
      if (rotina.data_fim && rotina.data_fim < primeiroDiaMes) {
        await postgres.query(
          `UPDATE "condominio-bh".tb_fin_receita_rotina SET ativo = false, updated_at = now() WHERE id = :id`,
          { replacements: { id: rotina.id } }
        );
        console.log(`[gerarReceitasRotina] Rotina id=${rotina.id} encerrada (data_fim atingida).`);
        continue;
      }

      const jaGerada = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_fin_receitas
          WHERE id_rotina = :id_rotina AND TO_CHAR(competencia, 'YYYY-MM') = :competencia
          LIMIT 1`,
        { replacements: { id_rotina: rotina.id, competencia: competenciaAtual }, type: QueryTypes.SELECT }
      );
      if (jaGerada[0]) continue;

      const modeloRows = await postgres.query(
        `SELECT id_condominio, id_unidade, id_usuario, id_usuario_cadastro, categoria, descricao, valor,
                situacao, id_grupo_receita, id_categoria, grupo_receita, numero_documento, observacao
           FROM "condominio-bh".tb_fin_receitas
          WHERE id_rotina = :id_rotina
          ORDER BY id DESC
          LIMIT 1`,
        { replacements: { id_rotina: rotina.id }, type: QueryTypes.SELECT }
      );
      const modelo = modeloRows[0];
      if (!modelo) {
        console.warn(`[gerarReceitasRotina] Rotina id=${rotina.id} sem receita-modelo, pulando.`);
        continue;
      }

      const dataVencimento = calcularVencimentoRotina(rotina.dia_vencimento, ano, mes);

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_fin_receitas (
            id_condominio, id_unidade, id_usuario, id_usuario_cadastro, categoria, descricao, valor,
            competencia, data_vencimento, data_pagamento, situacao,
            id_grupo_receita, id_categoria, grupo_receita,
            numero_documento, observacao, id_rotina, created_at, updated_at
          ) VALUES (
            :id_condominio, :id_unidade, :id_usuario, :id_usuario_cadastro, :categoria, :descricao, :valor,
            :competencia::date, :data_vencimento::date, NULL, 'em_aberto',
            :id_grupo_receita, :id_categoria, :grupo_receita,
            :numero_documento, :observacao, :id_rotina, now(), now()
          )`,
        {
          replacements: {
            id_condominio: modelo.id_condominio,
            id_unidade: modelo.id_unidade,
            id_usuario: modelo.id_usuario,
            id_usuario_cadastro: modelo.id_usuario_cadastro,
            categoria: modelo.categoria,
            descricao: modelo.descricao,
            valor: modelo.valor,
            competencia: primeiroDiaMes,
            data_vencimento: dataVencimento,
            id_grupo_receita: modelo.id_grupo_receita,
            id_categoria: modelo.id_categoria,
            grupo_receita: modelo.grupo_receita,
            numero_documento: modelo.numero_documento,
            observacao: modelo.observacao,
            id_rotina: rotina.id,
          },
        }
      );
      console.log(`[gerarReceitasRotina] Receita gerada para rotina id=${rotina.id}, competência ${competenciaAtual}.`);
    } catch (err) {
      console.error(`[gerarReceitasRotina] Erro ao processar rotina id=${rotina.id}:`, err?.message);
    }
  }
}

// Executa todo dia às 6h (horário de Brasília)
cron.schedule(
  '0 6 * * *',
  () => {
    console.log('[gerarReceitasRotina] Iniciando geração de receitas de rotina...');
    gerarReceitasRotina().catch((err) =>
      console.error('[gerarReceitasRotina] Erro inesperado:', err?.message)
    );
  },
  { timezone: 'America/Sao_Paulo' }
);

console.log('[gerarReceitasRotina] Cron de geração de receitas de rotina agendado (06:00 BRT).');

module.exports = { gerarReceitasRotina, calcularVencimentoRotina };
