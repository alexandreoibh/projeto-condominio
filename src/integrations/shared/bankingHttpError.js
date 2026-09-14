'use strict';

/**
 * Erro padronizado para chamadas HTTP a providers bancários, uniformizando
 * o tratamento em controllers independente de qual banco falhou.
 */
class BankingHttpError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {number} [opts.status] Status HTTP retornado pelo provider.
   * @param {string} [opts.codigoProvider] Código de erro específico do provider.
   * @param {boolean} [opts.retryable] Se true, o erro é transitório (5xx/timeout).
   * @param {object} [opts.respostaBruta] Corpo bruto da resposta, para log.
   */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'BankingHttpError';
    this.status = opts.status || null;
    this.codigoProvider = opts.codigoProvider || null;
    this.retryable = opts.retryable || false;
    this.respostaBruta = opts.respostaBruta || null;
  }
}

module.exports = BankingHttpError;
