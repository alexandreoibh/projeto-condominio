const fetch = require('node-fetch');

const DISPATCH_URL = process.env.WHATSAPP_DISPATCH_URL;
// Pendente de confirmação do time de front: por padrão reaproveita a mesma chave do
// serviço de e-mail (PUBLIC_EMAIL_DISPATCH_KEY). Se/quando o front confirmar uma chave
// dedicada, definir PUBLIC_WHATSAPP_DISPATCH_KEY no ambiente — ela tem prioridade.
const DISPATCH_KEY = process.env.PUBLIC_WHATSAPP_DISPATCH_KEY || process.env.PUBLIC_EMAIL_DISPATCH_KEY;
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

async function _post(payload) {
  return fetch(DISPATCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DISPATCH_KEY}`,
      'X-Public-Whatsapp-Key': DISPATCH_KEY
    },
    body: JSON.stringify(payload),
    timeout: TIMEOUT_MS
  });
}

function _normalizarTelefones(telefones) {
  if (Array.isArray(telefones)) return telefones.filter(Boolean).map((t) => String(t).trim());
  if (telefones) return [String(telefones).trim()];
  return [];
}

async function despacharWhatsapp(payload) {
  if (!DISPATCH_URL || !DISPATCH_KEY) {
    console.warn('[whatsappDispatch] WHATSAPP_DISPATCH_URL ou chave (PUBLIC_WHATSAPP_DISPATCH_KEY/PUBLIC_EMAIL_DISPATCH_KEY) não configurados.');
    return;
  }

  const telefones = _normalizarTelefones(payload.telefones);
  const body = {
    id_condominio: payload.id_condominio,
    telefones,
    mensagem: payload.mensagem,
  };

  const ref = payload._id_agenda ?? payload._ref ?? '?';

  let lastError;

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      const resp = await _post(body);
      const texto = await resp.text();
      let data = null;
      try { data = JSON.parse(texto); } catch {}

      if (resp.ok && data?.success) {
        console.log(`[whatsappDispatch] OK ref=${ref} status=${resp.status} recipients=${data?.recipient_count ?? '?'} sent=${data?.sent_count ?? '?'} failed=${data?.failed_count ?? '?'}`);
        return;
      }

      // Erro 4xx: não faz retry
      if (resp.status >= 400 && resp.status < 500) {
        console.error(`[whatsappDispatch] Falha permanente ref=${ref} status=${resp.status} msg=${data?.message}`);
        return;
      }

      // 5xx: tenta novamente
      lastError = new Error(data?.message || `HTTP ${resp.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  console.error(`[whatsappDispatch] Falha após ${MAX_RETRIES} tentativas ref=${ref}:`, lastError?.message);
}

module.exports = { despacharWhatsapp };
