const cron = require('node-cron');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const FinanceiroController = require('../controllers/financeiroController');

const financeiroController = new FinanceiroController();

// Chave fixa do advisory lock que impede duas execuções simultâneas (cron
// externo chamando em paralelo, ou node-cron local + endpoint ao mesmo tempo).
const ADVISORY_LOCK_ROTINAS = 742001;

function calcularVencimentoRotina(diaVencimento, ano, mes) {
  const ultimoDiaMes = new Date(ano, mes, 0).getDate();
  const diaNumerico = Number.parseInt(diaVencimento, 10);
  const dia = diaVencimento === 'ultimo_dia'
    ? ultimoDiaMes
    : Math.min(Number.isNaN(diaNumerico) ? ultimoDiaMes : diaNumerico, ultimoDiaMes);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Ano/mês em horário de Brasília — na Vercel o relógio é UTC, e entre 21h e
// 24h BRT do último dia do mês o new Date() já estaria no mês seguinte.
function _anoMesBrasilia() {
  const [ano, mes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).format(new Date()).split('-').map((parte) => Number.parseInt(parte, 10));
  return { ano, mes };
}

/**
 * Gera as receitas do mês corrente para todas as rotinas ativas (todos os
 * condomínios). Idempotente por rotina+mês: rotina que já tem receita na
 * competência é ignorada. Chamada pelo node-cron (local) e pelo endpoint
 * POST /api/condominio/financeiro/receitas/rotinas/processar (cron externo).
 *
 * @param {object} [opcoes]
 * @param {number} [opcoes.limite] Máximo de receitas GERADAS nesta chamada
 *   (rotinas já geradas não contam). Sem limite = processa tudo.
 * @returns {Promise<object>} Resumo; { em_execucao: true } se outra execução
 *   já estiver em andamento.
 */
async function gerarReceitasRotina({ limite = null } = {}) {
  const { ano, mes } = _anoMesBrasilia();
  const primeiroDiaMes = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const competenciaAtual = `${ano}-${String(mes).padStart(2, '0')}`;

  const resumo = {
    competencia: competenciaAtual,
    processadas: 0,
    geradas: 0,
    ignoradas: 0,
    encerradas: 0,
    erros: [],
    restantes: 0,
    boletos: { emitidos: 0, falhas: 0 },
  };

  // Advisory lock de transação (pg_try_advisory_xact_lock, PG 9.1+): fica preso
  // à conexão desta transação e é liberado sozinho no commit/rollback — não
  // depende de qual conexão do pool as demais queries usam.
  const transacaoLock = await postgres.transaction();
  try {
    const [[lock]] = await postgres.query(
      'SELECT pg_try_advisory_xact_lock(:chave) AS obtido',
      { replacements: { chave: ADVISORY_LOCK_ROTINAS }, transaction: transacaoLock }
    );
    if (!lock?.obtido) {
      await transacaoLock.rollback();
      console.warn('[gerarReceitasRotina] Outra execução já está em andamento — chamada ignorada.');
      return { ...resumo, em_execucao: true };
    }

    const rotinas = await postgres.query(
      `SELECT id, id_condominio, dia_vencimento, data_fim
         FROM "condominio-bh".tb_fin_receita_rotina
        WHERE ativo = true
        ORDER BY id`,
      { type: QueryTypes.SELECT }
    );

    for (const rotina of rotinas || []) {
      if (limite !== null && resumo.geradas >= limite) break;
      resumo.processadas += 1;

      try {
        if (rotina.data_fim && rotina.data_fim < primeiroDiaMes) {
          await postgres.query(
            `UPDATE "condominio-bh".tb_fin_receita_rotina SET ativo = false, updated_at = now() WHERE id = :id`,
            { replacements: { id: rotina.id } }
          );
          resumo.encerradas += 1;
          console.log(`[gerarReceitasRotina] Rotina id=${rotina.id} encerrada (data_fim atingida).`);
          continue;
        }

        const jaGerada = await postgres.query(
          `SELECT id FROM "condominio-bh".tb_fin_receitas
            WHERE id_rotina = :id_rotina AND TO_CHAR(competencia, 'YYYY-MM') = :competencia
            LIMIT 1`,
          { replacements: { id_rotina: rotina.id, competencia: competenciaAtual }, type: QueryTypes.SELECT }
        );
        if (jaGerada[0]) {
          resumo.ignoradas += 1;
          continue;
        }

        const modeloRows = await postgres.query(
          `SELECT id_condominio, id_unidade, id_usuario, id_usuario_cadastro, categoria, descricao, valor, valor_fundo_reserva,
                  situacao, id_grupo_receita, id_categoria, grupo_receita, numero_documento, observacao
             FROM "condominio-bh".tb_fin_receitas
            WHERE id_rotina = :id_rotina
            ORDER BY id DESC
            LIMIT 1`,
          { replacements: { id_rotina: rotina.id }, type: QueryTypes.SELECT }
        );
        const modelo = modeloRows[0];
        if (!modelo) {
          resumo.ignoradas += 1;
          console.warn(`[gerarReceitasRotina] Rotina id=${rotina.id} sem receita-modelo, pulando.`);
          continue;
        }

        const dataVencimento = calcularVencimentoRotina(rotina.dia_vencimento, ano, mes);

        const [insertRows] = await postgres.query(
          `INSERT INTO "condominio-bh".tb_fin_receitas (
              id_condominio, id_unidade, id_usuario, id_usuario_cadastro, categoria, descricao, valor, valor_fundo_reserva,
              competencia, data_vencimento, data_pagamento, situacao,
              id_grupo_receita, id_categoria, grupo_receita,
              numero_documento, observacao, id_rotina, created_at, updated_at
            ) VALUES (
              :id_condominio, :id_unidade, :id_usuario, :id_usuario_cadastro, :categoria, :descricao, :valor, :valor_fundo_reserva,
              :competencia::date, :data_vencimento::date, NULL, 'em_aberto',
              :id_grupo_receita, :id_categoria, :grupo_receita,
              :numero_documento, :observacao, :id_rotina, now(), now()
            ) RETURNING id`,
          {
            replacements: {
              id_condominio: modelo.id_condominio,
              id_unidade: modelo.id_unidade,
              id_usuario: modelo.id_usuario,
              id_usuario_cadastro: modelo.id_usuario_cadastro,
              categoria: modelo.categoria,
              descricao: modelo.descricao,
              valor: modelo.valor,
              valor_fundo_reserva: modelo.valor_fundo_reserva,
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
        const idReceitaGerada = insertRows[0].id;
        resumo.geradas += 1;
        console.log(`[gerarReceitasRotina] Receita id=${idReceitaGerada} gerada para rotina id=${rotina.id}, competência ${competenciaAtual}.`);

        // Emissão automática de boleto bancário — mesma regra de criarReceita:
        // toda receita com origem MORADOR (qualquer grupo) e pagador definido
        // dispara emissão automática. Best-effort: nunca interrompe a geração
        // das demais receitas da rotina se a emissão falhar para uma delas.
        if (modelo.grupo_receita === 'MORADOR' && modelo.id_usuario) {
          try {
            const resultadoBoleto = await financeiroController._emitirBoletoBancarioParaReceita({
              idCondominio: modelo.id_condominio,
              idReceita: idReceitaGerada,
              idUsuarioSolicitante: modelo.id_usuario_cadastro,
            });
            if (resultadoBoleto.ok) {
              resumo.boletos.emitidos += 1;
            } else {
              resumo.boletos.falhas += 1;
              console.warn(`[gerarReceitasRotina] Emissão automática de boleto falhou para receita id=${idReceitaGerada}: ${resultadoBoleto.message}`);
            }
          } catch (boletoErr) {
            resumo.boletos.falhas += 1;
            console.error(`[gerarReceitasRotina] Erro ao emitir boleto automático para receita id=${idReceitaGerada}:`, boletoErr?.message);
          }

          // E-mail de cobrança ao morador (best-effort, nunca lança).
          await financeiroController._enviarEmailCobrancaReceita({
            idCondominio: modelo.id_condominio,
            idReceita: idReceitaGerada,
          });
        }
      } catch (err) {
        resumo.erros.push({ id_rotina: rotina.id, mensagem: err?.message || String(err) });
        console.error(`[gerarReceitasRotina] Erro ao processar rotina id=${rotina.id}:`, err?.message);
      }
    }

    // Quantas rotinas ativas ainda não têm receita nesta competência — o cron
    // externo chama de novo enquanto houver (lote limitado por chamada).
    const [pendentes] = await postgres.query(
      `SELECT COUNT(*)::int AS total
         FROM "condominio-bh".tb_fin_receita_rotina rot
        WHERE rot.ativo = true
          AND (rot.data_fim IS NULL OR rot.data_fim >= :primeiro_dia::date)
          AND EXISTS (SELECT 1 FROM "condominio-bh".tb_fin_receitas m WHERE m.id_rotina = rot.id)
          AND NOT EXISTS (
            SELECT 1 FROM "condominio-bh".tb_fin_receitas r
             WHERE r.id_rotina = rot.id AND TO_CHAR(r.competencia, 'YYYY-MM') = :competencia
          )`,
      { replacements: { primeiro_dia: primeiroDiaMes, competencia: competenciaAtual }, type: QueryTypes.SELECT }
    );
    resumo.restantes = pendentes?.total || 0;

    await transacaoLock.commit();
    return resumo;
  } catch (err) {
    if (!transacaoLock.finished) await transacaoLock.rollback().catch(() => {});
    throw err;
  }
}

// Executa todo dia às 6h (horário de Brasília) — só funciona em processo
// contínuo (npm start local). Na Vercel serverless quem dispara é o cron
// externo via POST /api/condominio/financeiro/receitas/rotinas/processar.
cron.schedule(
  '0 6 * * *',
  () => {
    console.log('[gerarReceitasRotina] Iniciando geração de receitas de rotina...');
    gerarReceitasRotina()
      .then((resumo) => console.log('[gerarReceitasRotina] Concluído:', JSON.stringify(resumo)))
      .catch((err) => console.error('[gerarReceitasRotina] Erro inesperado:', err?.message));
  },
  { timezone: 'America/Sao_Paulo' }
);

console.log('[gerarReceitasRotina] Cron de geração de receitas de rotina agendado (06:00 BRT).');

module.exports = { gerarReceitasRotina, calcularVencimentoRotina };
