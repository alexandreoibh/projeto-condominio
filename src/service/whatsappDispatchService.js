const fetch = require('node-fetch');
const { RESULTADO, enviarUmaVez, sanitizarErro } = require('./dispatchResultado');

// Variáveis lidas no momento da chamada (não no carregamento do módulo).
// Chave: PUBLIC_WHATSAPP_DISPATCH_KEY tem prioridade; fallback em
// PUBLIC_EMAIL_DISPATCH_KEY.
const _url = () => process.env.WHATSAPP_DISPATCH_URL;
const _chave = () => process.env.PUBLIC_WHATSAPP_DISPATCH_KEY || process.env.PUBLIC_EMAIL_DISPATCH_KEY;
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;

// Canal WhatsApp desligado por padrão: só envia com WHATSAPP_ENABLED=true.
function whatsappHabilitado() {
  return String(process.env.WHATSAPP_ENABLED || '').trim().toLowerCase() === 'true';
}

function _headers(chave, ref) {
  return {
    'Authorization': `Bearer ${chave}`,
    'X-Public-Whatsapp-Key': chave,
    // Repassado ao fornecedor; deduplicação só existe se o endpoint PHP a implementar.
    ...(ref ? { 'X-Idempotency-Key': String(ref) } : {})
  };
}

function _normalizarTelefones(telefones) {
  if (Array.isArray(telefones)) return telefones.filter(Boolean).map((t) => String(t).trim());
  if (telefones) return [String(telefones).trim()];
  return [];
}

// Envio genérico (com retry em 5xx). Lança erro quando o canal está
// desativado/sem configuração ou o fornecedor recusa: nunca "sucesso" falso.
async function despacharWhatsapp(payload) {
  if (!whatsappHabilitado()) {
    throw new Error('WHATSAPP_DESATIVADO');
  }
  const url = _url();
  const chave = _chave();
  if (!url || !chave) {
    throw new Error('WHATSAPP_NAO_CONFIGURADO');
  }

  const body = { telefones: _normalizarTelefones(payload.telefones), mensagem: payload.mensagem };
  const ref = payload._id_agenda ?? payload._ref ?? '?';
  let lastError;

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ..._headers(chave, ref) },
        body: JSON.stringify(body),
        timeout: TIMEOUT_MS
      });
      const texto = await resp.text();
      let data = null;
      try { data = JSON.parse(texto); } catch {}

      if (resp.ok && data?.success) {
        console.log(`[whatsappDispatch] OK ref=${ref} status=${resp.status}`);
        return;
      }
      if (resp.status >= 400 && resp.status < 500 || resp.ok) {
        console.error(`[whatsappDispatch] Falha permanente ref=${ref} status=${resp.status}`);
        throw Object.assign(new Error(`WHATSAPP_REJEITADO:HTTP_${resp.status}`), { permanente: true });
      }
      lastError = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      if (err.permanente) throw err;
      lastError = err;
    }
  }

  const msg = sanitizarErro(lastError?.message, [chave]);
  console.error(`[whatsappDispatch] Falha após ${MAX_RETRIES} tentativas ref=${ref}: ${msg}`);
  throw new Error(`WHATSAPP_FALHA: ${msg}`);
}

// Envio da fila: uma tentativa, resultado classificado, nunca lança.
async function enviarWhatsappFila({ telefone, mensagem, ref }) {
  if (!whatsappHabilitado()) {
    return { resultado: RESULTADO.DESATIVADO, http_status: null, codigo: 'WHATSAPP_DESATIVADO' };
  }
  const url = _url();
  const chave = _chave();
  if (!url || !chave) {
    return { resultado: RESULTADO.NAO_CONFIGURADO, http_status: null, codigo: 'WHATSAPP_NAO_CONFIGURADO' };
  }
  return enviarUmaVez({
    canal: 'WHATSAPP',
    ref,
    url,
    headers: _headers(chave, ref),
    body: { telefones: _normalizarTelefones(telefone), mensagem },
    timeoutMs: TIMEOUT_MS,
    sucessoNegocio: (data) => data.success === true,
    descricao: (data) => data.message,
    segredos: [chave]
  });
}

module.exports = { despacharWhatsapp, enviarWhatsappFila, whatsappHabilitado };
