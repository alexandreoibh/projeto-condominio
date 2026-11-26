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

// Retorna { ok: true } ou { ok: false, status, message } — nunca lança.
// Chamadores fire-and-forget podem ignorar o retorno; a fila de mensagens
// usa para marcar o item como falha.
async function despacharEmail(payload) {
  if (!DISPATCH_URL || !DISPATCH_KEY) {
    console.warn('[emailDispatch] EMAIL_DISPATCH_URL ou PUBLIC_EMAIL_DISPATCH_KEY não configurados.');
    return { ok: false, status: null, message: 'Serviço de e-mail não configurado (EMAIL_DISPATCH_URL/PUBLIC_EMAIL_DISPATCH_KEY).' };
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
        return { ok: true };
      }

      // Erro 4xx: não faz retry
      if (resp.status >= 400 && resp.status < 500) {
        console.error(`[emailDispatch] Falha permanente template=${template} ref=${ref} status=${resp.status} msg=${data?.message}`);
        return { ok: false, status: resp.status, message: data?.message || `HTTP ${resp.status}` };
      }

      // 5xx: tenta novamente
      lastError = new Error(data?.message || `HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  console.error(`[emailDispatch] Falha após ${MAX_RETRIES} tentativas template=${template} ref=${ref}:`, lastError?.message);
  return { ok: false, status: null, message: lastError?.message || 'Falha desconhecida no envio de e-mail.' };
}

// Alias mantido por compatibilidade com chamadas existentes
const despacharEmailReserva = despacharEmail;

// Envio da fila de mensagens: uma única tentativa (sem retry após timeout, que
// poderia duplicar), env lida no momento da chamada, valida `success` no corpo.
// Retorna { resultado, http_status, codigo }; nunca lança. "aceito" não é entrega.
async function enviarEmailFila(payload) {
  const { RESULTADO, enviarUmaVez } = require('./dispatchResultado');
  const url = process.env.EMAIL_DISPATCH_URL;
  const chave = process.env.PUBLIC_EMAIL_DISPATCH_KEY;
  if (!url || !chave) {
    return { resultado: RESULTADO.NAO_CONFIGURADO, http_status: null, codigo: 'EMAIL_NAO_CONFIGURADO' };
  }
  const ref = payload._ref ?? '?';
  return enviarUmaVez({
    canal: 'EMAIL',
    ref,
    url,
    headers: {
      'Authorization': `Bearer ${chave}`,
      'X-Public-Email-Key': chave,
      // Repassado ao endpoint PHP; deduplicação só existe se ele a implementar.
      'X-Idempotency-Key': String(ref)
    },
    body: payload,
    timeoutMs: TIMEOUT_MS,
    sucessoNegocio: (data) => data.success === true,
    descricao: (data) => data.message,
    segredos: [chave]
  });
}

module.exports = { despacharEmail, despacharEmailReserva, enviarEmailFila };
