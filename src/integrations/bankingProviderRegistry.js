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
  consultarCobrancaPdf: require('./inter/interCobrancaService').consultarCobrancaPdf,
  consultarExtrato: require('./inter/interExtratoService').consultarExtrato,
  consultarSaldo: require('./inter/interExtratoService').consultarSaldo,
  processarWebhook: require('./inter/interWebhookHandler').processarWebhook,
});

// TODO confirmar contra sandbox real — ver TODOs em src/integrations/itau/*.
// Estrutura completa seguindo o mesmo contrato do Inter, aguardando
// client_id/client_secret de sandbox para validação empírica.
providers.set('itau', {
  testarConexao: require('./itau/itauAuthClient').testarConexao,
  emitirCobranca: require('./itau/itauCobrancaService').emitirCobranca,
  consultarCobranca: require('./itau/itauCobrancaService').consultarCobranca,
  cancelarCobranca: require('./itau/itauCobrancaService').cancelarCobranca,
  consultarCobrancaPdf: require('./itau/itauCobrancaService').consultarCobrancaPdf,
  consultarExtrato: require('./itau/itauExtratoService').consultarExtrato,
  consultarSaldo: require('./itau/itauExtratoService').consultarSaldo,
  processarWebhook: require('./itau/itauWebhookHandler').processarWebhook,
});

// Paths e shapes confirmados via collections Postman reais do sandbox
// Bradesco (não apenas melhor-esforço como o Itaú) — ver TODOs em
// src/integrations/bradesco/* para os pontos ainda não validados por
// chamada real (credencial de sandbox aguardando habilitação).
providers.set('bradesco', {
  testarConexao: require('./bradesco/bradescoAuthClient').testarConexao,
  emitirCobranca: require('./bradesco/bradescoCobrancaService').emitirCobranca,
  consultarCobranca: require('./bradesco/bradescoCobrancaService').consultarCobranca,
  cancelarCobranca: require('./bradesco/bradescoCobrancaService').cancelarCobranca,
  consultarCobrancaPdf: require('./bradesco/bradescoCobrancaService').consultarCobrancaPdf,
  consultarExtrato: require('./bradesco/bradescoExtratoService').consultarExtrato,
  consultarSaldo: require('./bradesco/bradescoExtratoService').consultarSaldo,
  processarWebhook: require('./bradesco/bradescoWebhookHandler').processarWebhook,
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
