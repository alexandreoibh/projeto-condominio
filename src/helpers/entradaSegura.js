'use strict';

// Auditoria SQLi 27/11/2026 (F2): o parser de query do Express ("extended"/qs)
// transforma ?a=1&a=2 em array e ?a[b]=1 em objeto. Nenhuma rota consome
// array/objeto vindo da query, e esses valores chegavam crus aos replacements
// do Sequelize (array vira "'1','2'", objeto lança "Invalid value") → erro SQL
// 500. Aqui a requisição é rejeitada com 400 ANTES de qualquer consulta.
// O valor recebido nunca é logado nem devolvido.
function rejeitarQueryNaoEscalar(req, res, next) {
  const query = req.query || {};
  for (const chave of Object.keys(query)) {
    if (typeof query[chave] !== 'string') {
      console.warn(`[entrada_invalida] query não escalar: ${req.method} ${String(req.originalUrl || '').split('?')[0]} campo=${String(chave).slice(0, 60)}`);
      return res.status(400).json({ message: 'Parâmetro inválido.' });
    }
  }
  return next();
}

// Remove o valor recebido dos erros do express-validator (inclusive aninhados),
// para não ecoar payloads maliciosos na resposta 422.
function errosValidacaoSemValor(erros) {
  return (erros || []).map((erro) => {
    const { value, nestedErrors, ...resto } = erro || {};
    if (Array.isArray(nestedErrors)) resto.nestedErrors = errosValidacaoSemValor(nestedErrors);
    return resto;
  });
}

module.exports = { rejeitarQueryNaoEscalar, errosValidacaoSemValor };
