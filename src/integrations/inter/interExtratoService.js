'use strict';

// Endpoint/formato exatos de extrato e saldo do Inter dependem de
// confirmação contra o Swagger do Inter Developers — ver plano, seção
// "Riscos", item 2. Implementação real entra na Fase 6 (Extrato).

/* eslint-disable no-unused-vars */
async function consultarExtrato(credencial, dataInicio, dataFim) {
  throw new Error('interExtratoService.consultarExtrato ainda não implementado (Fase 6).');
}

async function consultarSaldo(credencial) {
  throw new Error('interExtratoService.consultarSaldo ainda não implementado (Fase 6).');
}
/* eslint-enable no-unused-vars */

module.exports = { consultarExtrato, consultarSaldo };
