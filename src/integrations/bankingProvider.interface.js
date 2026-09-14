'use strict';

/**
 * Contrato que todo provider bancário/fintech (Inter, e futuramente outros
 * bancos) deve implementar. Não é uma interface TS — é a lista de métodos
 * que `bankingProviderRegistry` espera encontrar no módulo do provider.
 *
 * Todo método recebe `credencial` como primeiro argumento: a linha
 * (já descriptografada em memória) de `tb_fin_integracao_bancaria`
 * correspondente ao condomínio/provider/ambiente em uso.
 *
 * Cada método deve retornar um shape normalizado (não o JSON cru do banco),
 * para que quem chama (financeiroController, integracaoBancariaController)
 * nunca precise saber qual provider está por trás.
 *
 * @typedef {Object} BankingProvider
 * @property {(credencial: object) => Promise<{ok: boolean, erro?: string}>} testarConexao
 *   Faz só o passo de autenticação (OAuth/mTLS), sem operação de negócio —
 *   usado no cadastro da credencial para dar feedback imediato ao síndico.
 * @property {(credencial: object, dadosCobranca: object) => Promise<object>} emitirCobranca
 *   Emite uma cobrança (boleto hoje, PIX futuramente) vinculada a uma receita.
 * @property {(credencial: object, idExterno: string) => Promise<object>} consultarCobranca
 * @property {(credencial: object, idExterno: string, motivo: string) => Promise<object>} cancelarCobranca
 * @property {(credencial: object, dataInicio: string, dataFim: string) => Promise<object[]>} consultarExtrato
 * @property {(credencial: object) => Promise<object>} consultarSaldo
 * @property {(credencial: object, payload: object) => Promise<{tipoEvento: string, idExterno: string, situacao: string, dadosBrutos: object}>} processarWebhook
 *   Interpreta o payload recebido no webhook e devolve a intenção de
 *   atualização — não escreve no banco diretamente, quem persiste é o
 *   handler da rota de webhook (mantém o provider testável isoladamente).
 */

module.exports = {};
