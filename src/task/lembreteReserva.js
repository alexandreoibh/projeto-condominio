const cron = require('node-cron');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { despacharEmail } = require('../service/emailDispatchService');

async function enviarLembretesReservas() {
  const amanha = new Date();
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  amanha.setUTCHours(0, 0, 0, 0);

  const depoisDeAmanha = new Date(amanha);
  depoisDeAmanha.setUTCDate(depoisDeAmanha.getUTCDate() + 1);

  let reservas;
  try {
    reservas = await postgres.query(
      `SELECT
          ea.id,
          ea.periodo_manha,
          ea.periodo_tarde,
          ea.periodo_noite,
          ea.modo_sala,
          ea.data_agendamento,
          ea.observacoes,
          tu.nome    AS morador_nome,
          tu.email   AS morador_email,
          tu.apartamento,
          tu.bloco,
          te.nome    AS espaco_nome,
          tc.nome    AS condominio_nome
         FROM "condominio-bh".tb_espaco_agenda ea
         JOIN "condominio-bh"."tb-usuarios"     tu ON tu.id = ea.id_usuario
         JOIN "condominio-bh".tb_espaco         te ON te.id = ea.id_espaco
         JOIN "condominio-bh"."tb-condominios"  tc ON tc.id::text = ea.id_condominio::text
        WHERE ea.data_agendamento >= :amanha
          AND ea.data_agendamento <  :depoisDeAmanha
          AND ea.status IN (1, 2, 3)
          AND tu.email IS NOT NULL AND tu.email <> ''`,
      {
        replacements: { amanha, depoisDeAmanha },
        type: QueryTypes.SELECT
      }
    );
  } catch (err) {
    console.error('[lembreteReserva] Erro ao buscar reservas:', err?.message);
    return;
  }

  if (!reservas || reservas.length === 0) {
    console.log('[lembreteReserva] Nenhuma reserva para amanhã.');
    return;
  }

  console.log(`[lembreteReserva] Enviando lembretes para ${reservas.length} reserva(s).`);

  for (const r of reservas) {
    const periodos = [];
    if (r.periodo_manha) periodos.push('Manhã');
    if (r.periodo_tarde) periodos.push('Tarde');
    if (r.periodo_noite) periodos.push('Noite');
    const periodoTexto =
      String(r.modo_sala || '').toLowerCase() === 'dia_inteiro'
        ? 'Dia Inteiro'
        : periodos.join(', ') || '-';

    const dataFormatada = r.data_agendamento
      ? new Date(r.data_agendamento).toISOString().slice(0, 10).split('-').reverse().join('/')
      : '';

    try {
      await despacharEmail({
        _ref: `lembrete_${r.id}`,
        template: 'reserva_lembrete',
        emails: [r.morador_email],
        solicitante: {
          nome: r.morador_nome || '',
          email: r.morador_email || '',
          apartamento: r.apartamento || '',
          bloco: r.bloco || ''
        },
        reserva: {
          sala_nome: r.espaco_nome || '',
          data: dataFormatada,
          periodo: periodoTexto,
          observacao: r.observacoes || '',
          condominio_nome: r.condominio_nome || ''
        }
      });
    } catch (emailErr) {
      console.error(`[lembreteReserva] Erro ao enviar lembrete reserva id=${r.id}:`, emailErr?.message);
    }
  }
}

// Executa todo dia às 7h (horário de Brasília)
cron.schedule(
  '0 7 * * *',
  () => {
    console.log('[lembreteReserva] Iniciando envio de lembretes...');
    enviarLembretesReservas().catch((err) =>
      console.error('[lembreteReserva] Erro inesperado:', err?.message)
    );
  },
  { timezone: 'America/Sao_Paulo' }
);

console.log('[lembreteReserva] Cron de lembrete de reserva agendado (07:00 BRT).');
