'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { body } = require('express-validator');

const IntegracaoBancariaController = require('../controllers/integracaoBancariaController');
const auth = require('../helpers/auth');
const validate = require('../helpers/validate');

const controller = new IntegracaoBancariaController();

const uploadCertificado = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
});

// ── Listagem ──────────────────────────────────────────────────────────────

router.get('/', auth, controller.listarIntegracoes.bind(controller));

// ── Conectar Inter (multipart: client_id, client_secret, ambiente + arquivos) ──

router.post(
  '/inter/conectar',
  auth,
  uploadCertificado.fields([
    { name: 'certificado', maxCount: 1 },
    { name: 'chave_privada', maxCount: 1 },
  ]),
  [
    body('client_id').notEmpty().withMessage('client_id é obrigatório.'),
    body('client_secret').notEmpty().withMessage('client_secret é obrigatório.'),
    body('ambiente').optional({ nullable: true, checkFalsy: true }).isIn(['sandbox', 'production']).withMessage('ambiente deve ser "sandbox" ou "production".'),
  ],
  validate,
  controller.conectarInter.bind(controller)
);

// ── Testar / Desativar ──────────────────────────────────────────────────────

router.post('/:id/testar', auth, controller.testarIntegracao.bind(controller));
router.delete('/:id', auth, controller.desativarIntegracao.bind(controller));

module.exports = router;
