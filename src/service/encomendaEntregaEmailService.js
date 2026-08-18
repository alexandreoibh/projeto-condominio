const fetch = require('node-fetch');

const DISPATCH_URL = process.env.ENCOMENDA_ENTREGA_EMAIL_URL;
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

async function despacharEncomendaEntregaEmail(payload) {
  if (!DISPATCH_URL || !DISPATCH_KEY) {
    console.warn('[encomendaEntregaEmail] ENCOMENDA_ENTREGA_EMAIL_URL ou PUBLIC_EMAIL_DISPATCH_KEY não configurados.');
    return;
  }

  const ref = payload?.encomenda?.id_registro ?? '?';
  let lastError;

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      const resp = await _post(payload);
      const texto = await resp.text();
      let data = null;
      try { data = JSON.parse(texto); } catch {}

      if (resp.ok) {
        console.log(`[encomendaEntregaEmail] OK id_registro=${ref} status=${resp.status}`);
        return;
      }

      // Erro 4xx: não faz retry
      if (resp.status >= 400 && resp.status < 500) {
        console.error(`[encomendaEntregaEmail] Falha permanente id_registro=${ref} status=${resp.status} msg=${data?.message}`);
        return;
      }

      // 5xx: tenta novamente
      lastError = new Error(data?.message || `HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  console.error(`[encomendaEntregaEmail] Falha após ${MAX_RETRIES} tentativas id_registro=${ref}:`, lastError?.message);
}

module.exports = { despacharEncomendaEntregaEmail };
