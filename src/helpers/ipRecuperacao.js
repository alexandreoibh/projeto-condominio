'use strict';

// IP do cliente para o fluxo de RECUPERAÇÃO DE SENHA (regra própria; o
// helpers/ipCliente.js usado pelo login não muda).
//
// - Origem em TRUSTED_PROXY_IPS (o servidor PHP): a requisição PRECISA vir
//   autenticada com X-Proxy-Key == PROXY_SHARED_SECRET e trazer X-Client-IP
//   válido. Sem chave válida → 401; IP do cliente ausente/inválido → 400;
//   segredo não configurado → 503. Nunca "IP desconhecido": um proxy sem
//   autenticação não ignora o limite por IP.
// - Loopback: só é tratado como proxy fora de produção e se trouxer a chave
//   (desenvolvimento local do PHP). Sem a chave, vale como cliente direto.
// - Qualquer outra origem (app, chamada direta à Vercel): X-Client-IP,
//   X-IP e body.ip são ignorados; vale o IP observado (trust proxy da Vercel).

const crypto = require('crypto');
const net = require('net');
const { ipObservado } = require('./ipCliente');

const LOOPBACK = new Set(['127.0.0.1', '::1']);

const _normalizar = (valor) => String(valor || '').trim().replace(/^::ffff:/, '');

function _proxiesConfiaveis() {
  return new Set(
    String(process.env.TRUSTED_PROXY_IPS || '')
      .split(',')
      .map(_normalizar)
      .filter((ip) => ip && net.isIP(ip))
  );
}

function _chaveConfere(recebida, esperada) {
  const a = crypto.createHash('sha256').update(String(recebida || '')).digest();
  const b = crypto.createHash('sha256').update(String(esperada || '')).digest();
  return crypto.timingSafeEqual(a, b) && String(recebida || '').length > 0;
}

// Retorna { ok: true, ip, viaProxy } ou { ok: false, status, code, message }.
function resolverIpRecuperacao(req) {
  const observado = _normalizar(ipObservado(req));
  const chaveRecebida = req?.headers?.['x-proxy-key'];
  const ehProxy = _proxiesConfiaveis().has(observado);
  const ehLoopbackDev = LOOPBACK.has(observado) && process.env.NODE_ENV !== 'production' && Boolean(chaveRecebida);

  if (ehProxy || ehLoopbackDev) {
    const segredo = process.env.PROXY_SHARED_SECRET;
    if (!segredo) {
      return { ok: false, status: 503, code: 'PROXY_NAO_CONFIGURADO', message: 'Serviço temporariamente indisponível.' };
    }
    if (!_chaveConfere(chaveRecebida, segredo)) {
      return { ok: false, status: 401, code: 'proxy_nao_autenticado', message: 'Requisição de proxy não autenticada.' };
    }
    const informado = _normalizar(req?.headers?.['x-client-ip']);
    if (!informado || !net.isIP(informado)) {
      return { ok: false, status: 400, code: 'CLIENT_IP_INVALIDO', message: 'X-Client-IP ausente ou inválido.' };
    }
    return { ok: true, ip: informado, viaProxy: observado };
  }

  // Cliente direto: nunca confia em IP declarado.
  return { ok: true, ip: observado || 'desconhecido', viaProxy: null };
}

module.exports = { resolverIpRecuperacao };
