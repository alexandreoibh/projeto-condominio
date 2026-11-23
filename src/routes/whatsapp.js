'use strict';

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../helpers/auth');
const { exigirAdmin } = require('../helpers/permissoes');
const validate = require('../helpers/validate');
const WhatsappController = require('../controllers/whatsappController');

const controller = new WhatsappController();

router.get('/instancia', auth, controller.obterInstancia.bind(controller));

router.post(
  '/instancia',
  auth,
  exigirAdmin,
  [
    body('instance_name').notEmpty().withMessage('instance_name é obrigatório.'),
    body('status').isIn(['DESCONECTADO', 'CONECTANDO', 'CONECTADO']).withMessage('status inválido.'),
    body('telefone').optional({ nullable: true, checkFalsy: true }).isString(),
    body('nome_perfil').optional({ nullable: true, checkFalsy: true }).isString(),
  ],
  validate,
  controller.salvarInstancia.bind(controller)
);

module.exports = router;
