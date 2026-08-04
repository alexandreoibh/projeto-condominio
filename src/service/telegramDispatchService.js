const fetch = require('node-fetch');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

function _apiUrl(method) {
  return `${API_BASE}/bot${BOT_TOKEN}/${method}`;
}

async function _post(method, payload) {
  return fetch(_apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: TIMEOUT_MS
  });
}

async function despacharTelegram(payload) {
  if (!BOT_TOKEN) {
    console.warn('[telegramDispatch] TELEGRAM_BOT_TOKEN não configurado.');
    return;
  }

  const body = {
    chat_id: payload.chat_id,
    text: payload.mensagem
  };

  const ref = payload._id_agenda ?? payload._ref ?? '?';

  let lastError;
  let permanente = false;

  for (let tentativa = 1; tentativa <= MAX_RETRIES && !permanente; tentativa++) {
    try {
      const resp = await _post('sendMessage', body);
      const texto = await resp.text();
      let data = null;
      try { data = JSON.parse(texto); } catch {}

      if (resp.ok && data?.ok) {
        console.log(`[telegramDispatch] OK ref=${ref} status=${resp.status}`);
        return;
      }

      lastError = new Error(data?.description || `HTTP ${resp.status}`);

      // Erro 4xx: não faz retry
      if (resp.status >= 400 && resp.status < 500) {
        console.error(`[telegramDispatch] Falha permanente ref=${ref} status=${resp.status} msg=${lastError.message}`);
        permanente = true;
      }
    } catch (err) {
      // erro de rede/timeout: elegível para retry
      lastError = err;
    }
  }

  console.error(`[telegramDispatch] Falha após ${permanente ? 1 : MAX_RETRIES} tentativa(s) ref=${ref}:`, lastError?.message);
  throw lastError || new Error('Falha ao despachar mensagem Telegram.');
}

module.exports = { despacharTelegram };
