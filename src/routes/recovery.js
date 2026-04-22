'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../helpers/validate');
const CondominioController = require('../controllers/condominioController');

const controller = new CondominioController();

// POST /api/auth/recovery/request
router.post(
  '/request',
  [
    body('login')
      .notEmpty().withMessage('Campo login é obrigatório.')
      .bail()
      .custom((value) => {
        const s = String(value).trim();
        const cpf = s.replace(/\D/g, '');
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (cpf.length === 11 || emailRe.test(s.toLowerCase())) return true;
        throw new Error('login deve ser e-mail válido ou CPF com 11 dígitos.');
      })
  ],
  validate,
  controller.recoveryRequest.bind(controller)
);

// POST /api/auth/recovery/verify
router.post(
  '/verify',
  [
    body('user_id').notEmpty().isInt({ min: 1 }).withMessage('Campo user_id inválido.'),
    body('code')
      .notEmpty().withMessage('Campo code é obrigatório.')
      .isLength({ min: 6, max: 6 }).withMessage('code deve ter exatamente 6 dígitos.')
      .isNumeric().withMessage('code deve ser numérico.')
  ],
  validate,
  controller.recoveryVerify.bind(controller)
);

// POST /api/auth/recovery/reset
router.post(
  '/reset',
  [
    body('user_id').notEmpty().isInt({ min: 1 }).withMessage('Campo user_id inválido.'),
    body('invite_token').notEmpty().withMessage('Campo invite_token é obrigatório.'),
    body('password')
      .notEmpty().withMessage('Campo password é obrigatório.')
      .isLength({ min: 6 }).withMessage('password deve ter no mínimo 6 caracteres.')
  ],
  validate,
  controller.recoveryReset.bind(controller)
);

module.exports = router;
