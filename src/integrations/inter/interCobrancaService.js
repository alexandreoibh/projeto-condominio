'use strict';

// Payload/resposta exatos da API de cobrança do Inter (paths, campos de
// nosso-número/linha digitável, etc.) dependem de confirmação contra o
// Swagger do Inter Developers — ver plano, seção "Riscos", item 2.
// Implementação real entra na Fase 4 (Boleto).

/* eslint-disable no-unused-vars */
async function emitirCobranca(credencial, dadosCobranca) {
  throw new Error('interCobrancaService.emitirCobranca ainda não implementado (Fase 4).');
}

async function consultarCobranca(credencial, idExterno) {
  throw new Error('interCobrancaService.consultarCobranca ainda não implementado (Fase 4).');
}

async function cancelarCobranca(credencial, idExterno, motivo) {
  throw new Error('interCobrancaService.cancelarCobranca ainda não implementado (Fase 4).');
}
/* eslint-enable no-unused-vars */

module.exports = { emitirCobranca, consultarCobranca, cancelarCobranca };
