const fetch = require('node-fetch');
const { RESULTADO, enviarUmaVez, sanitizarErro } = require('./dispatchResultado');

// Token lido no momento da chamada. Ele vai na URL da API, então todo texto de
// erro (o node-fetch inclui a URL) passa por sanitizarErro antes de log/retorno.
const _token = () => process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

function _apiUrl(method) {
  return `${API_BASE}/bot${_token()}/${method}`;
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
  if (!_token()) {
    console.warn('[telegramDispatch] TELEGRAM_BOT_TOKEN não configurado.');
    return;
  }

  const body = {
    chat_id: payload.chat_id,
    text: payload.mensagem
  };

  if (payload.parse_mode) {
    body.parse_mode = payload.parse_mode;
  }

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
        console.error(`[telegramDispatch] Falha permanente ref=${ref} status=${resp.status} msg=${sanitizarErro(lastError.message, [_token()])}`);
        permanente = true;
      }
    } catch (err) {
      // erro de rede/timeout: elegível para retry
      lastError = err;
    }
  }

  const msg = sanitizarErro(lastError?.message || 'Falha ao despachar mensagem Telegram.', [_token()]);
  console.error(`[telegramDispatch] Falha após ${permanente ? 1 : MAX_RETRIES} tentativa(s) ref=${ref}: ${msg}`);
  throw new Error(msg);
}

// Envio da fila: uma tentativa (a API do Telegram não tem idempotência, então
// repetir após timeout pode duplicar), resultado classificado, nunca lança.
async function enviarTelegramFila({ chat_id, mensagem, parse_mode, ref }) {
  const token = _token();
  if (!token) {
    return { resultado: RESULTADO.NAO_CONFIGURADO, http_status: null, codigo: 'TELEGRAM_NAO_CONFIGURADO' };
  }
  const body = { chat_id, text: mensagem };
  if (parse_mode) body.parse_mode = parse_mode;
  return enviarUmaVez({
    canal: 'TELEGRAM',
    ref,
    url: _apiUrl('sendMessage'),
    headers: {},
    body,
    timeoutMs: TIMEOUT_MS,
    sucessoNegocio: (data) => data.ok === true,
    descricao: (data) => data.description,
    segredos: [token]
  });
}

module.exports = { despacharTelegram, enviarTelegramFila };
