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

// user_id (app legado) ou login (e-mail/CPF) identifica o usuário.
const userIdOuLogin = [
  body('user_id').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Campo user_id inválido.'),
  body('login').optional({ nullable: true, checkFalsy: true }).isLength({ max: 255 }).withMessage('Campo login inválido.'),
  body().custom((value, { req }) => {
    if (!req.body?.user_id && !req.body?.login) {
      throw new Error('Informe user_id ou login.');
    }
    return true;
  })
];

// POST /api/auth/recovery/verify
router.post(
  '/verify',
  [
    ...userIdOuLogin,
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
    ...userIdOuLogin,
    body().custom((value, { req }) => {
      if (!req.body?.reset_token && !req.body?.invite_token && !req.body?.token) {
        throw new Error('Campo reset_token (ou invite_token) é obrigatório.');
      }
      return true;
    }),
    body('password')
      .notEmpty().withMessage('Campo password é obrigatório.')
      .isLength({ min: 6 }).withMessage('password deve ter no mínimo 6 caracteres.')
  ],
  validate,
  controller.recoveryReset.bind(controller)
);

module.exports = router;
