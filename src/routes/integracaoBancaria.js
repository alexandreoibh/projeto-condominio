'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { body } = require('express-validator');

const IntegracaoBancariaController = require('../controllers/integracaoBancariaController');
const auth = require('../helpers/auth');
const validate = require('../helpers/validate');

const controller = new IntegracaoBancariaController();

// Multa/juros por atraso: obrigatórios, 0–100, até 2 casas ("2.00", "2" ou 2).
// Acima do limite legal (2% / 1% a.m.) é aceito — o front exige confirmação
// e o controller registra log de auditoria.
function validarTaxaObrigatoria(campo, mensagemObrigatoria) {
  return body(campo)
    .exists({ checkNull: true, checkFalsy: false })
    .withMessage(mensagemObrigatoria)
    .bail()
    .custom((value) => String(value).trim() !== '')
    .withMessage(mensagemObrigatoria)
    .bail()
    .custom((value) => /^\d{1,3}(\.\d{1,2})?$/.test(String(value).trim()) && Number(value) <= 100)
    .withMessage(`${campo} deve ser um número entre 0 e 100 com até 2 casas decimais (ex.: "2.00").`);
}

const validacoesMultaJuros = [
  validarTaxaObrigatoria('multa_percentual', 'Multa por atraso é obrigatória.'),
  validarTaxaObrigatoria('juros_mora_percentual_mes', 'Juros de mora são obrigatórios.'),
];

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
    ...validacoesMultaJuros,
  ],
  validate,
  controller.conectarInter.bind(controller)
);

// ── Conectar Itaú (multipart: client_id, client_secret, ambiente + arquivos opcionais) ──

router.post(
  '/itau/conectar',
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
  controller.conectarItau.bind(controller)
);

// ── Conectar Bradesco (multipart: client_id, client_secret, ambiente + arquivos) ──

router.post(
  '/bradesco/conectar',
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
  controller.conectarBradesco.bind(controller)
);

// ── Regras de cobrança por atraso (multa % / juros de mora % ao mês) ─────────

// Atualiza só multa/juros (JSON) — não mexe em credenciais/certificado.
router.put(
  '/:id',
  auth,
  validacoesMultaJuros,
  validate,
  controller.atualizarRegrasCobranca.bind(controller)
);

// ── Testar / Saldo / Desativar ───────────────────────────────────────────────

router.post('/:id/testar', auth, controller.testarIntegracao.bind(controller));
router.get('/:id/saldo', auth, controller.consultarSaldo.bind(controller));
router.get('/:id/extrato', auth, controller.consultarExtrato.bind(controller));
router.delete('/:id', auth, controller.desativarIntegracao.bind(controller));

module.exports = router;
