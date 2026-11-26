'use strict';

// Resultado padronizado dos envios da fila de mensagens (tb_mensagens_fila).
// "ACEITO" = o fornecedor aceitou a mensagem; NÃO é confirmação de entrega
// ao destinatário.

const RESULTADO = Object.freeze({
  ACEITO: 'aceito',
  REJEITADO: 'rejeitado', // fornecedor respondeu recusando: nada foi enviado
  INDETERMINADO: 'indeterminado', // timeout/rede/502/504: pode ter sido enviado
  NAO_CONFIGURADO: 'nao_configurado',
  DESATIVADO: 'desativado'
});

// 502/504: o gateway pode ter repassado a requisição ao fornecedor antes de
// falhar, então o resultado é incerto. Demais 5xx são recusa explícita.
const HTTP_INDETERMINADO = new Set([502, 504]);

/**
 * Classifica a resposta HTTP do fornecedor.
 * @param {number} httpStatus
 * @param {object|null} data corpo JSON (null se ilegível)
 * @param {(data:object) => boolean} sucessoNegocio confere o sucesso de negócio
 */
function classificarResposta(httpStatus, data, sucessoNegocio) {
  if (httpStatus >= 200 && httpStatus < 300) {
    if (data === null) return RESULTADO.INDETERMINADO; // 2xx com corpo ilegível
    return sucessoNegocio(data) ? RESULTADO.ACEITO : RESULTADO.REJEITADO;
  }
  if (HTTP_INDETERMINADO.has(httpStatus)) return RESULTADO.INDETERMINADO;
  return RESULTADO.REJEITADO;
}

// Remove segredos (tokens, chaves), URLs, e-mails e telefones de um texto de
// erro antes de logar ou gravar em `falha`. Limita o tamanho.
function sanitizarErro(texto, segredos = [], max = 200) {
  let saida = String(texto == null ? '' : texto);
  for (const segredo of segredos) {
    if (segredo && String(segredo).length >= 4) {
      saida = saida.split(String(segredo)).join('***');
    }
  }
  saida = saida
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[numero]');
  return saida.slice(0, max);
}

// Uma única tentativa HTTP (sem retry: repetir após timeout/erro de rede pode
// duplicar a mensagem, pois o fornecedor pode já tê-la recebido).
// Retorna { resultado, http_status, codigo }; nunca lança.
async function enviarUmaVez({ canal, ref, url, headers, body, timeoutMs, sucessoNegocio, descricao, segredos = [] }) {
  const fetch = require('node-fetch');
  let httpStatus = null;
  let data = null;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      timeout: timeoutMs
    });
    httpStatus = resp.status;
    const texto = await resp.text();
    try { data = JSON.parse(texto); } catch (_) { data = null; }
  } catch (err) {
    const codigo = `${canal}_INDETERMINADO:${sanitizarErro(err && (err.type || err.code || err.name), segredos, 40) || 'erro_rede'}`;
    console.error(`[${canal.toLowerCase()}Fila] ref=${ref} resultado=indeterminado codigo=${codigo}`);
    return { resultado: RESULTADO.INDETERMINADO, http_status: null, codigo };
  }

  const resultado = classificarResposta(httpStatus, data, sucessoNegocio);
  let codigo = null;
  if (resultado !== RESULTADO.ACEITO) {
    const extra = data && descricao ? sanitizarErro(descricao(data), segredos, 120) : '';
    codigo = `${canal}_${resultado.toUpperCase()}:HTTP_${httpStatus}${extra ? ` ${extra}` : ''}`;
  }
  const log = `[${canal.toLowerCase()}Fila] ref=${ref} resultado=${resultado} status=${httpStatus}`;
  if (resultado === RESULTADO.ACEITO) console.log(log); else console.error(log);
  return { resultado, http_status: httpStatus, codigo };
}

module.exports = { RESULTADO, classificarResposta, sanitizarErro, enviarUmaVez };
