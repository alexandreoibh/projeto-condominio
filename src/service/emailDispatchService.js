const fetch = require('node-fetch');

const DISPATCH_URL = process.env.EMAIL_DISPATCH_URL;
const DISPATCH_KEY = process.env.PUBLIC_EMAIL_DISPATCH_KEY;
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

async function _post(payload) {
  return fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DISPATCH_KEY}`,
      'X-Public-Email-Key': DISPATCH_KEY
    },
    body: JSON.stringify(payload),
    timeout: TIMEOUT_MS
  });
}

async function despacharEmail(payload) {
  if (!DISPATCH_URL || !DISPATCH_KEY) {
    console.warn('[emailDispatch] EMAIL_DISPATCH_URL ou PUBLIC_EMAIL_DISPATCH_KEY não configurados.');
    return;
  }

  const ref = payload._id_agenda ?? payload._ref ?? '?';
  const template = payload.template ?? '?';

  let lastError;

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      const resp = await _post(payload);
      const texto = await resp.text();
      let data = null;
      try { data = JSON.parse(texto); } catch {}

      if (resp.ok && data?.success) {
        console.log(`[emailDispatch] OK template=${template} ref=${ref} status=${resp.status} recipients=${data?.recipient_count ?? '?'}`);
        return;
      }

      // Erro 4xx: não faz retry
      if (resp.status >= 400 && resp.status < 500) {
        console.error(`[emailDispatch] Falha permanente template=${template} ref=${ref} status=${resp.status} msg=${data?.message}`);
        return;
      }

      // 5xx: tenta novamente
      lastError = new Error(data?.message || `HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  console.error(`[emailDispatch] Falha após ${MAX_RETRIES} tentativas template=${template} ref=${ref}:`, lastError?.message);
}

// Alias mantido por compatibilidade com chamadas existentes
const despacharEmailReserva = despacharEmail;

module.exports = { despacharEmail, despacharEmailReserva };
