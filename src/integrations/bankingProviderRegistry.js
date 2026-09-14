'use strict';

/**
 * Ponto único de extensão para novos bancos/fintechs: para adicionar um
 * segundo provider, registrar a chave aqui — nenhum controller/rota precisa
 * mudar (eles sempre chamam `getProvider(credencial.provider)`).
 */
const providers = new Map();

providers.set('inter', {
  testarConexao: require('./inter/interAuthClient').testarConexao,
  emitirCobranca: require('./inter/interCobrancaService').emitirCobranca,
  consultarCobranca: require('./inter/interCobrancaService').consultarCobranca,
  cancelarCobranca: require('./inter/interCobrancaService').cancelarCobranca,
  consultarExtrato: require('./inter/interExtratoService').consultarExtrato,
  consultarSaldo: require('./inter/interExtratoService').consultarSaldo,
  processarWebhook: require('./inter/interWebhookHandler').processarWebhook,
});

/**
 * @param {string} nomeProvider
 * @returns {import('./bankingProvider.interface').BankingProvider}
 */
function getProvider(nomeProvider) {
  const provider = providers.get(nomeProvider);
  if (!provider) {
    throw new Error(`Provider bancário desconhecido: "${nomeProvider}"`);
  }
  return provider;
}

function listarProvidersDisponiveis() {
  return Array.from(providers.keys());
}

module.exports = { getProvider, listarProvidersDisponiveis };
