'use strict';

// IP do cliente para rate limit, log de acesso e auditoria.
//
// O back-cond.php chama este backend em localhost (ou, na Vercel, a partir do
// IP do servidor PHP). Para o backend, todos os moradores teriam o mesmo IP, e
// os limites por IP bloqueariam o site inteiro. Por isso, SÓ quando a requisição
// vem de um proxy confiável (loopback ou TRUSTED_PROXY_IPS) o IP do cliente
// informado pelo proxy (X-Client-IP / body.ip) é aceito. De qualquer outra
// origem, o IP declarado é ignorado e vale req.ip (com trust proxy da Vercel).

const net = require('net');

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);

const _normalizarIp = (valor) => String(valor || '').trim().replace(/^::ffff:/, '');

const _proxiesConfiaveis = () =>
  new Set(
    String(process.env.TRUSTED_PROXY_IPS || '')
      .split(',')
      .map(_normalizarIp)
      .filter(Boolean)
  );

function ipObservado(req) {
  const ip = _normalizarIp(req?.ip || req?.socket?.remoteAddress || '');
  return ip || null;
}

function ehProxyConfiavel(ip) {
  if (!ip) return false;
  return LOOPBACK_IPS.has(ip) || _proxiesConfiaveis().has(ip);
}

// IP do cliente informado pelo proxy, só se for um IP válido.
function ipInformadoPeloProxy(req) {
  const headers = req?.headers && typeof req.headers === 'object' ? req.headers : {};
  const bruto = req?.body?.ip ?? headers['x-client-ip'] ?? headers['x-ip'];
  const ip = _normalizarIp(bruto);
  return ip && net.isIP(ip) ? ip : null;
}

// { ip, viaProxy }
// - requisição direta: ip = req.ip, viaProxy = null;
// - via proxy confiável: ip = IP informado pelo proxy (ou null, se não veio ou
//   é inválido), viaProxy = IP do proxy.
function ipEfetivo(req) {
  const observado = ipObservado(req);
  if (!ehProxyConfiavel(observado)) {
    return { ip: observado, viaProxy: null };
  }
  return { ip: ipInformadoPeloProxy(req), viaProxy: observado };
}

module.exports = { ipEfetivo, ipObservado, ehProxyConfiavel, ipInformadoPeloProxy };
