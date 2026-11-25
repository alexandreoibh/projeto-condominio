'use strict';

// Rate limit persistente no PostgreSQL ("condominio-bh".tb_rate_limit,
// migration 20261125000001). Atômico entre instâncias da Vercel: cada
// operação é um único INSERT ... ON CONFLICT ... RETURNING.
//
// Fail closed: qualquer erro (tabela ausente, banco fora) vira
// ErroRateLimitIndisponivel (status 503). Quem chama NÃO deve prosseguir.
//
// As chaves nunca contêm dados pessoais em claro (login entra como HMAC).

const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');

const RETENCAO_HORAS = 48;
const LOTE_LIMPEZA = 1000;
const MAX_LOTES_LIMPEZA = 5;

class ErroRateLimitIndisponivel extends Error {
  constructor(causa) {
    super('Rate limit indisponível.');
    this.name = 'ErroRateLimitIndisponivel';
    this.status = 503;
    this.causa = causa ? String(causa.message || causa) : null;
  }
}

// Executor padrão (Sequelize, replacements nomeados). Testes com PostgreSQL
// real injetam outro executor com a mesma assinatura (sql, replacements) => rows.
const executorPadrao = (sql, replacements) => postgres.query(sql, { replacements, type: QueryTypes.SELECT });

function _validarChave(chave) {
  const texto = String(chave || '');
  if (!texto || texto.length > 200) {
    throw new ErroRateLimitIndisponivel(new Error('chave de rate limit inválida'));
  }
  return texto;
}

// Incrementa o contador da janela fixa atual (janelaSeg) e devolve se ainda
// está dentro do limite. A reserva retornada guarda a janela ORIGINAL, usada
// por devolver().
async function consumir(chave, limite, janelaSeg, { executor = executorPadrao } = {}) {
  const chaveOk = _validarChave(chave);
  let rows;
  try {
    rows = await executor(
      `INSERT INTO "condominio-bh".tb_rate_limit (chave, janela, contador, atualizado_em)
       VALUES (
         :chave,
         to_timestamp(floor(extract(epoch FROM now()) / CAST(:janela_seg AS integer)) * CAST(:janela_seg AS integer)),
         1,
         now()
       )
       ON CONFLICT (chave, janela)
       DO UPDATE SET contador = tb_rate_limit.contador + 1, atualizado_em = now()
       RETURNING contador, janela`,
      { chave: chaveOk, janela_seg: janelaSeg }
    );
  } catch (error) {
    throw new ErroRateLimitIndisponivel(error);
  }
  const row = rows && rows[0];
  if (!row) {
    throw new ErroRateLimitIndisponivel(new Error('consumir sem retorno'));
  }
  const contador = Number.parseInt(row.contador, 10);
  return { chave: chaveOk, janela: row.janela, contador, limite, permitido: contador <= limite };
}

// Desfaz uma reserva na MESMA janela em que foi feita; nunca fica negativo.
async function devolver(reserva, { executor = executorPadrao } = {}) {
  if (!reserva || !reserva.chave || !reserva.janela) return;
  try {
    await executor(
      `UPDATE "condominio-bh".tb_rate_limit
          SET contador = GREATEST(contador - 1, 0), atualizado_em = now()
        WHERE chave = :chave AND janela = :janela
        RETURNING contador`,
      { chave: reserva.chave, janela: reserva.janela }
    );
  } catch (error) {
    throw new ErroRateLimitIndisponivel(error);
  }
}

// Intervalo mínimo entre eventos da mesma chave (ex.: 60 s entre envios de
// código para a mesma conta). Atômico: o UPDATE só acontece se o último
// evento for mais antigo que `segundos`; sem linha retornada = bloqueado.
async function cooldown(chave, segundos, { executor = executorPadrao } = {}) {
  const chaveOk = _validarChave(chave);
  let rows;
  try {
    rows = await executor(
      `INSERT INTO "condominio-bh".tb_rate_limit (chave, janela, contador, atualizado_em)
       VALUES (:chave, to_timestamp(0), 1, now())
       ON CONFLICT (chave, janela)
       DO UPDATE SET contador = tb_rate_limit.contador + 1, atualizado_em = now()
        WHERE tb_rate_limit.atualizado_em <= now() - make_interval(secs => CAST(:segundos AS double precision))
       RETURNING contador`,
      { chave: chaveOk, segundos }
    );
  } catch (error) {
    throw new ErroRateLimitIndisponivel(error);
  }
  return { permitido: Boolean(rows && rows[0]) };
}

// Retenção de 48 h, em lotes pequenos (não segura lock longo na tabela).
async function limparRateLimit({ executor = executorPadrao } = {}) {
  let total = 0;
  for (let lote = 0; lote < MAX_LOTES_LIMPEZA; lote += 1) {
    const rows = await executor(
      `WITH apagadas AS (
         DELETE FROM "condominio-bh".tb_rate_limit
          WHERE ctid IN (
            SELECT ctid FROM "condominio-bh".tb_rate_limit
             WHERE atualizado_em < now() - make_interval(hours => CAST(:horas AS integer))
             LIMIT CAST(:lote AS integer)
          )
         RETURNING 1
       )
       SELECT count(*) AS apagadas FROM apagadas`,
      { horas: RETENCAO_HORAS, lote: LOTE_LIMPEZA }
    );
    const apagadas = Number.parseInt(rows && rows[0] ? rows[0].apagadas : 0, 10) || 0;
    total += apagadas;
    if (apagadas < LOTE_LIMPEZA) break;
  }
  return total;
}

module.exports = {
  consumir,
  devolver,
  cooldown,
  limparRateLimit,
  ErroRateLimitIndisponivel,
  RETENCAO_HORAS
};
