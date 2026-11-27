const { validationResult } = require('express-validator');
const { errosValidacaoSemValor } = require('./entradaSegura');

module.exports = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // `value` (entrada recebida) não é devolvido: evita ecoar payload malicioso.
      return res.status(422).json({ errors: errosValidacaoSemValor(errors.array()) });
    }else{
        next()
    }
}
