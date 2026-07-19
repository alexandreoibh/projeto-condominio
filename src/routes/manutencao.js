'use strict';

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const ManutencaoController = require('../controllers/manutencaoController');
const auth = require('../helpers/auth');
const validate = require('../helpers/validate');

const controller = new ManutencaoController();

const FREQUENCIAS = ['DIARIA', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const UNIDADES_TEMPO = ['DIA', 'SEMANA', 'MES', 'ANO'];
const STATUS_ROTINA = ['EM_DIA', 'PENDENTE', 'ATRASADA', 'EM_EXECUCAO', 'CONCLUIDA', 'CANCELADA'];
const STATUS_EXECUCAO = ['CONCLUIDA', 'PENDENTE', 'ATRASADA', 'EM_EXECUCAO', 'CANCELADA'];

// ── Tipos de Rotina ────────────────────────────────────────────────────────────

router.get(
  '/tipos-rotina',
  auth,
  [
    query('ativo').optional({ nullable: true, checkFalsy: true }).isIn(['todos']).withMessage('ativo aceita apenas "todos".'),
  ],
  validate,
  controller.listarTiposRotina.bind(controller)
);

// ── Rotinas de Manutenção ──────────────────────────────────────────────────────

router.get(
  '/rotinas',
  auth,
  [
    query('status_rotina').optional({ nullable: true, checkFalsy: true }).isIn(STATUS_ROTINA).withMessage('status_rotina inválido.'),
    query('id_tipo_rotina').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_tipo_rotina deve ser inteiro positivo.'),
    query('ativo').optional({ nullable: true, checkFalsy: true }).isIn(['S', 'N']).withMessage('ativo deve ser S ou N.'),
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
  ],
  validate,
  controller.listarRotinas.bind(controller)
);

router.post(
  '/rotinas',
  auth,
  [
    body('id_tipo_rotina').notEmpty().withMessage('id_tipo_rotina é obrigatório.').bail().isInt({ min: 1 }).withMessage('id_tipo_rotina deve ser inteiro positivo.'),
    body('id_fornecedor').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_fornecedor deve ser inteiro positivo.'),
    body('nome_rotina').notEmpty().withMessage('nome_rotina é obrigatório.').bail().isLength({ max: 150 }).withMessage('nome_rotina deve ter no máximo 150 caracteres.'),
    body('descricao').optional({ nullable: true }),
    body('local_rotina').optional({ nullable: true, checkFalsy: true }).isLength({ max: 150 }).withMessage('local_rotina deve ter no máximo 150 caracteres.'),
    body('frequencia').notEmpty().withMessage('frequencia é obrigatório.').bail().isIn(FREQUENCIAS).withMessage('frequencia inválida.'),
    body('intervalo_execucao').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('intervalo_execucao deve ser inteiro positivo.'),
    body('unidade_tempo').optional({ nullable: true, checkFalsy: true }).isIn(UNIDADES_TEMPO).withMessage('unidade_tempo inválida.'),
    body('data_inicio').notEmpty().withMessage('data_inicio é obrigatório.').bail().isISO8601().withMessage('data_inicio deve ser data válida.'),
    body('custo_estimado').optional({ nullable: true, checkFalsy: true }).isNumeric().withMessage('custo_estimado deve ser numérico.'),
    body('observacao').optional({ nullable: true }),
  ],
  validate,
  controller.criarRotina.bind(controller)
);

router.put(
  '/rotinas/:id',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('id_tipo_rotina').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_tipo_rotina deve ser inteiro positivo.'),
    body('id_fornecedor').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_fornecedor deve ser inteiro positivo.'),
    body('nome_rotina').optional().isLength({ max: 150 }).withMessage('nome_rotina deve ter no máximo 150 caracteres.'),
    body('descricao').optional({ nullable: true }),
    body('local_rotina').optional({ nullable: true, checkFalsy: true }).isLength({ max: 150 }).withMessage('local_rotina deve ter no máximo 150 caracteres.'),
    body('frequencia').optional().isIn(FREQUENCIAS).withMessage('frequencia inválida.'),
    body('intervalo_execucao').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('intervalo_execucao deve ser inteiro positivo.'),
    body('unidade_tempo').optional({ nullable: true, checkFalsy: true }).isIn(UNIDADES_TEMPO).withMessage('unidade_tempo inválida.'),
    body('data_inicio').optional().isISO8601().withMessage('data_inicio deve ser data válida.'),
    body('proxima_execucao').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('proxima_execucao deve ser data válida.'),
    body('ultima_execucao').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('ultima_execucao deve ser data válida.'),
    body('custo_estimado').optional({ nullable: true, checkFalsy: true }).isNumeric().withMessage('custo_estimado deve ser numérico.'),
    body('ativo').optional().isIn(['S', 'N']).withMessage('ativo deve ser S ou N.'),
    body('status_rotina').optional().isIn(STATUS_ROTINA).withMessage('status_rotina inválido.'),
    body('observacao').optional({ nullable: true }),
  ],
  validate,
  controller.atualizarRotina.bind(controller)
);

router.patch(
  '/rotinas/:id',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('status_rotina').optional().isIn(STATUS_ROTINA).withMessage('status_rotina inválido.'),
    body('ativo').optional().isIn(['S', 'N']).withMessage('ativo deve ser S ou N.'),
  ],
  validate,
  controller.atualizarStatusRotina.bind(controller)
);

// ── Execuções ──────────────────────────────────────────────────────────────────

router.get(
  '/rotinas/:id/execucoes',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
  ],
  validate,
  controller.listarExecucoes.bind(controller)
);

router.post(
  '/rotinas/:id/execucoes',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('data_execucao').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_execucao deve ser data válida.'),
    body('status_execucao').optional().isIn(STATUS_EXECUCAO).withMessage('status_execucao inválido.'),
    body('custo_real').optional({ nullable: true, checkFalsy: true }).isNumeric().withMessage('custo_real deve ser numérico.'),
    body('observacao_execucao').optional({ nullable: true }),
    body('anexo_execucao').optional({ nullable: true, checkFalsy: true }).isLength({ max: 255 }).withMessage('anexo_execucao deve ter no máximo 255 caracteres.'),
  ],
  validate,
  controller.registrarExecucao.bind(controller)
);

module.exports = router;
