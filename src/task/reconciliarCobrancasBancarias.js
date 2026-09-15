const cron = require('node-cron');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const bankingProviderRegistry = require('../integrations/bankingProviderRegistry');
const cobrancaBancariaRepository = require('../integrations/shared/cobrancaBancariaRepository');

// Rede de segurança para o caso (raro, mas possível) de o webhook do banco
// nunca chegar — instabilidade de rede pontual, URL de webhook trocada sem
// reprocessar eventos antigos, etc. Reconsulta ativamente cada cobrança
// ainda "emitida" há mais de MARGEM_MINUTOS, comparando com a situação real
// no provider. Não substitui o webhook (que é a via rápida, quase
// instantânea) — só cobre a lacuna quando ele falha silenciosamente.
const MARGEM_MINUTOS = 30;

const SITUACOES_PAGAS = new Set(['RECEBIDO', 'PAGO', 'MARCADO_RECEBIDO']);
const SITUACOES_CANCELADAS = new Set(['CANCELADO', 'EXPIRADO']);

function _normalizarSituacaoInter(situacaoInter) {
  if (SITUACOES_PAGAS.has(situacaoInter)) return 'pago';
  if (SITUACOES_CANCELADAS.has(situacaoInter)) return 'cancelado';
  return 'em_aberto';
}

async function reconciliarCobrancasBancarias() {
  let cobrancasPendentes;
  try {
    cobrancasPendentes = await postgres.query(
      `SELECT cb.id AS id_cobranca, cb.id_condominio, cb.id_receita, cb.provider AS cb_provider,
              cb.situacao, cb.id_externo, cb.valor, cb.created_at,
              ib.*
         FROM "condominio-bh".tb_fin_cobranca_bancaria cb
         JOIN "condominio-bh".tb_fin_integracao_bancaria ib ON ib.id = cb.id_integracao_bancaria
        WHERE cb.situacao = 'emitida'
          AND cb.created_at < NOW() - INTERVAL '${MARGEM_MINUTOS} minutes'`,
      { type: QueryTypes.SELECT }
    );
  } catch (err) {
    console.error('[reconciliarCobrancasBancarias] Erro ao buscar cobranças pendentes:', err?.message);
    return;
  }

  if (!cobrancasPendentes || cobrancasPendentes.length === 0) {
    console.log('[reconciliarCobrancasBancarias] Nenhuma cobrança pendente de reconciliação.');
    return;
  }

  for (const linha of cobrancasPendentes) {
    // `linha` traz colunas de tb_fin_cobranca_bancaria (prefixadas/renomeadas
    // para evitar colisão com `id`/`provider` de tb_fin_integracao_bancaria)
    // e todas as colunas da credencial (ib.*) — o próprio objeto `linha`
    // serve como `credencial` para o provider (tem certificado/token etc).
    const cobranca = {
      id: linha.id_cobranca,
      id_condominio: linha.id_condominio,
      id_receita: linha.id_receita,
      provider: linha.cb_provider,
      situacao: linha.situacao,
    };

    try {
      const provider = bankingProviderRegistry.getProvider(cobranca.provider);
      const detalhado = await provider.consultarCobranca(linha, linha.id_externo);
      const situacaoNormalizada = _normalizarSituacaoInter(detalhado.cobranca?.situacao);

      const atualizou = await cobrancaBancariaRepository.aplicarSituacao(cobranca, situacaoNormalizada);
      if (atualizou) {
        console.log(`[reconciliarCobrancasBancarias] Cobrança id=${cobranca.id} (receita id=${cobranca.id_receita}) atualizada para "${situacaoNormalizada}" via reconciliação ativa.`);
      }
    } catch (err) {
      console.error(`[reconciliarCobrancasBancarias] Erro ao reconciliar cobrança id=${cobranca.id}:`, err?.message);
    }
  }
}

// Executa a cada hora, no minuto 15 (evita coincidir exatamente com outros
// crons agendados no minuto 0, ex: gerarReceitasRotina às 6h em ponto).
cron.schedule(
  '15 * * * *',
  () => {
    console.log('[reconciliarCobrancasBancarias] Iniciando reconciliação de cobranças bancárias...');
    reconciliarCobrancasBancarias().catch((err) =>
      console.error('[reconciliarCobrancasBancarias] Erro inesperado:', err?.message)
    );
  },
  { timezone: 'America/Sao_Paulo' }
);

console.log('[reconciliarCobrancasBancarias] Cron de reconciliação de cobranças bancárias agendado (a cada hora, minuto 15).');

module.exports = { reconciliarCobrancasBancarias };
