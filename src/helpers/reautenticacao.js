'use strict';

// Reautenticação para operações de alto impacto (incidente 22/11/2026): um
// JWT roubado não basta para trocar as credenciais da integração bancária,
// que decidem para qual conta vão os pagamentos dos boletos. A requisição
// precisa trazer `senha_atual` do próprio usuário autenticado.
//
// Use depois de `auth` (e do multer, nas rotas multipart, para o body existir).

const bcrypt = require('bcryptjs');
const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const { registrarAuditoria } = require('./auditoria');

function _ehHashBcrypt(valor) {
  return /^\$2[aby]\$\d{2}\$/.test(String(valor || ''));
}

function exigirSenhaAtual(contexto) {
  return async (req, res, next) => {
    try {
      const senhaAtual = req.body?.senha_atual;
      if (senhaAtual === undefined || senhaAtual === null || String(senhaAtual) === '') {
        return res.status(422).json({
          message: 'Confirme a sua senha (senha_atual) para esta operação.',
          error_code: 'current_password_required'
        });
      }

      const idUsuario = Number.parseInt(req.idcliente, 10);
      const [usuario] = await postgres.query(
        `SELECT senha_hash FROM "condominio-bh"."tb-usuarios" WHERE id = :id LIMIT 1`,
        { replacements: { id: Number.isInteger(idUsuario) ? idUsuario : 0 }, type: QueryTypes.SELECT }
      );
      const hash = usuario ? usuario.senha_hash : null;
      const confere = _ehHashBcrypt(hash) ? await bcrypt.compare(String(senhaAtual), hash) : false;

      // A senha nunca segue para o controller nem para logs.
      delete req.body.senha_atual;

      if (!confere) {
        await registrarAuditoria({
          req,
          acao: 'reautenticacao_falhou',
          entidade: contexto,
          detalhes: { rota: req.originalUrl ? String(req.originalUrl).split('?')[0] : null }
        });
        return res.status(422).json({ message: 'Senha atual incorreta.', error_code: 'current_password_invalid' });
      }
      return next();
    } catch (error) {
      console.error('[reautenticacao] Falha ao conferir senha:', error?.message);
      return res.status(503).json({ message: 'Não foi possível confirmar a senha agora. Tente novamente.' });
    }
  };
}

module.exports = { exigirSenhaAtual };
