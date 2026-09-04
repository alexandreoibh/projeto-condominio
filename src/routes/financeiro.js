'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { body, param, query } = require('express-validator');

const FinanceiroController = require('../controllers/financeiroController');
const auth = require('../helpers/auth');
const validate = require('../helpers/validate');

const controller = new FinanceiroController();

const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── Grupo de Receita ──────────────────────────────────────────────────────────

router.get(
  '/grupo-receita',
  auth,
  [
    query('origem').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('origem deve ter no máximo 20 caracteres.'),
  ],
  validate,
  controller.listarGrupoReceita.bind(controller)
);

// ── Grupo de Despesa ──────────────────────────────────────────────────────────

router.get(
  '/grupo-despesa',
  auth,
  [
    query('origem').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('origem deve ter no máximo 20 caracteres.'),
  ],
  validate,
  controller.listarGrupoDespesa.bind(controller)
);

// ── Receitas ──────────────────────────────────────────────────────────────────

router.get(
  '/receitas',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    query('situacao').optional({ nullable: true, checkFalsy: true }).isIn(['em_aberto', 'pago', 'cancelado']).withMessage('situacao inválida.'),
    query('id_grupo_receita').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_grupo_receita deve ser inteiro positivo.'),
    query('id_unidade').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_unidade deve ser inteiro positivo.'),
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
    query('sort').optional({ nullable: true, checkFalsy: true }).isIn(['id', 'unidade', 'morador', 'categoria', 'situacao', 'valor_total']).withMessage('sort inválido.'),
    query('order').optional({ nullable: true, checkFalsy: true }).isIn(['asc', 'desc', 'ASC', 'DESC']).withMessage('order deve ser asc ou desc.'),
  ],
  validate,
  controller.listarReceitas.bind(controller)
);

router.post(
  '/receitas',
  auth,
  [
    body('descricao').optional({ nullable: true, checkFalsy: true }).isLength({ max: 255 }).withMessage('descricao deve ter no máximo 255 caracteres.'),
    body('valor').notEmpty().withMessage('valor é obrigatório.').bail().isNumeric().withMessage('valor deve ser numérico.'),
    body('valor_fundo_reserva').optional({ nullable: true, checkFalsy: true }).isNumeric().withMessage('valor_fundo_reserva deve ser numérico.'),
    body('competencia').notEmpty().withMessage('competencia é obrigatório.').bail().isISO8601().withMessage('competencia deve ser data válida.'),
    body('data_vencimento').notEmpty().withMessage('data_vencimento é obrigatório.').bail().isISO8601().withMessage('data_vencimento deve ser data válida.'),
    body('data_pagamento').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_pagamento deve ser data válida.'),
    body('situacao').optional().isIn(['em_aberto', 'pago', 'cancelado']).withMessage('situacao inválida.'),
    body('id_grupo_receita').notEmpty().withMessage('id_grupo_receita é obrigatório.').bail().isInt({ min: 1 }).withMessage('id_grupo_receita deve ser inteiro positivo.'),
    body('id_usuario').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_usuario deve ser inteiro positivo.'),
    body('id_unidade').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_unidade deve ser inteiro positivo.'),
    body('numero_documento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('numero_documento deve ter no máximo 100 caracteres.'),
    body('observacao').optional({ nullable: true }),
    body('is_rotina').optional().isBoolean().withMessage('is_rotina deve ser booleano.'),
    body('rotina_dia_vencimento')
      .custom((value, { req }) => {
        const isRotina = req.body.is_rotina === true || req.body.is_rotina === 'true';
        if (!isRotina) return true;
        const texto = String(value || '').trim();
        if (texto === 'ultimo_dia') return true;
        return /^\d{1,2}$/.test(texto) && Number(texto) >= 1 && Number(texto) <= 31;
      })
      .withMessage('rotina_dia_vencimento deve ser um número de 1 a 31 ou "ultimo_dia" quando is_rotina é true.'),
    body('rotina_data_fim').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('rotina_data_fim deve ser data válida.'),
  ],
  validate,
  controller.criarReceita.bind(controller)
);

router.put(
  '/receitas/:id',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('categoria').optional().isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    body('descricao').optional().isLength({ max: 255 }).withMessage('descricao deve ter no máximo 255 caracteres.'),
    body('valor').optional().isNumeric().withMessage('valor deve ser numérico.'),
    body('valor_fundo_reserva').optional({ nullable: true, checkFalsy: true }).isNumeric().withMessage('valor_fundo_reserva deve ser numérico.'),
    body('competencia').optional().isISO8601().withMessage('competencia deve ser data válida.'),
    body('data_vencimento').optional().isISO8601().withMessage('data_vencimento deve ser data válida.'),
    body('data_pagamento').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_pagamento deve ser data válida.'),
    body('situacao').optional().isIn(['em_aberto', 'pago', 'cancelado']).withMessage('situacao inválida.'),
    body('id_grupo_receita').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_grupo_receita deve ser inteiro positivo.'),
    body('id_categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('id_categoria deve ter no máximo 100 caracteres.'),
    body('grupo_receita').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('grupo_receita deve ter no máximo 100 caracteres.'),
    body('numero_documento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('numero_documento deve ter no máximo 100 caracteres.'),
    body('observacao').optional({ nullable: true }),
  ],
  validate,
  controller.atualizarReceita.bind(controller)
);

router.delete(
  '/receitas/:id',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.excluirReceita.bind(controller)
);

router.post(
  '/receitas/:id/solicitar-2via',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.solicitar2ViaBoleto.bind(controller)
);

router.get(
  '/receita-consolidado',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    query('id_grupo_receita').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_grupo_receita deve ser inteiro positivo.'),
    query('periodo_inicio').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo_inicio deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('periodo_fim').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo_fim deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.consolidadoReceitas.bind(controller)
);

router.get(
  '/receitas/rotinas',
  auth,
  validate,
  controller.listarRotinasReceita.bind(controller)
);

router.delete(
  '/receitas/rotinas/:id',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.cancelarRotinaReceita.bind(controller)
);

// ── Despesas ──────────────────────────────────────────────────────────────────

router.get(
  '/despesas',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    query('situacao').optional({ nullable: true, checkFalsy: true }).isIn(['a_pagar', 'pago', 'cancelado']).withMessage('situacao inválida.'),
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
    query('sort').optional({ nullable: true, checkFalsy: true }).isIn(['id', 'fornecedor', 'categoria', 'situacao', 'valor']).withMessage('sort inválido.'),
    query('order').optional({ nullable: true, checkFalsy: true }).isIn(['asc', 'desc', 'ASC', 'DESC']).withMessage('order deve ser asc ou desc.'),
  ],
  validate,
  controller.listarDespesas.bind(controller)
);

router.post(
  '/despesas',
  auth,
  [
    body('categoria').notEmpty().withMessage('categoria é obrigatório.').bail().isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    body('descricao').optional({ nullable: true, checkFalsy: true }).isLength({ max: 255 }).withMessage('descricao deve ter no máximo 255 caracteres.'),
    body('valor').notEmpty().withMessage('valor é obrigatório.').bail().isNumeric().withMessage('valor deve ser numérico.'),
    body('competencia').notEmpty().withMessage('competencia é obrigatório.').bail().isISO8601().withMessage('competencia deve ser data válida.'),
    body('data_despesa').notEmpty().withMessage('data_despesa é obrigatório.').bail().isISO8601().withMessage('data_despesa deve ser data válida.'),
    body('data_pagamento').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_pagamento deve ser data válida.'),
    body('fornecedor').optional({ nullable: true, checkFalsy: true }).isLength({ max: 120 }).withMessage('fornecedor deve ter no máximo 120 caracteres.'),
    body('forma_pagamento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 60 }).withMessage('forma_pagamento deve ter no máximo 60 caracteres.'),
    body('situacao').optional().isIn(['a_pagar', 'pago', 'cancelado']).withMessage('situacao inválida.'),
    body('numero_documento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('numero_documento deve ter no máximo 100 caracteres.'),
    body('observacao').optional({ nullable: true }),
  ],
  validate,
  controller.criarDespesa.bind(controller)
);

router.put(
  '/despesas/:id',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('categoria').optional().isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    body('descricao').optional().isLength({ max: 255 }).withMessage('descricao deve ter no máximo 255 caracteres.'),
    body('valor').optional().isNumeric().withMessage('valor deve ser numérico.'),
    body('competencia').optional().isISO8601().withMessage('competencia deve ser data válida.'),
    body('data_despesa').optional().isISO8601().withMessage('data_despesa deve ser data válida.'),
    body('data_pagamento').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_pagamento deve ser data válida.'),
    body('fornecedor').optional({ nullable: true, checkFalsy: true }).isLength({ max: 120 }).withMessage('fornecedor deve ter no máximo 120 caracteres.'),
    body('forma_pagamento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 60 }).withMessage('forma_pagamento deve ter no máximo 60 caracteres.'),
    body('situacao').optional().isIn(['a_pagar', 'pago', 'cancelado']).withMessage('situacao inválida.'),
    body('numero_documento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('numero_documento deve ter no máximo 100 caracteres.'),
    body('observacao').optional({ nullable: true }),
  ],
  validate,
  controller.atualizarDespesa.bind(controller)
);

router.delete(
  '/despesas/:id',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.excluirDespesa.bind(controller)
);

router.get(
  '/despesa-consolidado',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 60 }).withMessage('categoria deve ter no máximo 60 caracteres.'),
    query('periodo_inicio').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo_inicio deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('periodo_fim').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo_fim deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.consolidadoDespesas.bind(controller)
);

router.get(
  '/despesas/:id/documentos',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.listarDocumentosDespesa.bind(controller)
);

router.post(
  '/despesas/:id/documentos',
  auth,
  uploadDoc.single('arquivo'),
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('tipo')
      .notEmpty().withMessage('tipo é obrigatório.')
      .bail()
      .isIn(['nota_fiscal', 'comprovante_pagamento', 'contrato', 'outro']).withMessage('tipo inválido.'),
  ],
  validate,
  controller.uploadDocumentoDespesa.bind(controller)
);

router.delete(
  '/despesas/:id/documentos/:docId',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    param('docId').isInt({ min: 1 }).withMessage('docId inválido.'),
  ],
  validate,
  controller.excluirDocumentoDespesa.bind(controller)
);

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get(
  '/dashboard',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.getDashboard.bind(controller)
);

router.get(
  '/dashboard/orcamento',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.getOrcamentoDashboard.bind(controller)
);

router.get(
  '/dashboard/fundo-reserva',
  auth,
  validate,
  controller.getFundoReserva.bind(controller)
);

router.put(
  '/dashboard/fundo-reserva/meta',
  auth,
  [
    body('valor_meta').isFloat({ min: 0 }).withMessage('valor_meta é obrigatório e deve ser maior ou igual a zero.'),
  ],
  validate,
  controller.atualizarMetaFundoReserva.bind(controller)
);

router.get(
  '/dashboard/score',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.getScoreFinanceiro.bind(controller)
);

router.get(
  '/dashboard/inadimplencia-serie',
  auth,
  [
    query('meses').optional().isInt({ min: 1, max: 24 }).withMessage('meses deve estar entre 1 e 24.'),
  ],
  validate,
  controller.getInadimplenciaSerie.bind(controller)
);

router.get(
  '/dashboard/consumo-utilidades',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('meses').optional().isInt({ min: 1, max: 24 }).withMessage('meses deve estar entre 1 e 24.'),
  ],
  validate,
  controller.getConsumoUtilidades.bind(controller)
);

router.get(
  '/lancamentos-recentes',
  auth,
  [
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit deve estar entre 1 e 50.'),
  ],
  validate,
  controller.listarLancamentosRecentes.bind(controller)
);

// ── Inadimplência ─────────────────────────────────────────────────────────────

router.get(
  '/inadimplencia',
  auth,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
    query('resumo').optional({ nullable: true, checkFalsy: true }).isIn(['0', '1']).withMessage('resumo deve ser 0 ou 1.'),
  ],
  validate,
  controller.listarInadimplencia.bind(controller)
);

router.post(
  '/inadimplencia/:id/cobrar',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('anexos_urls').optional({ nullable: true }).isArray({ max: 20 }).withMessage('anexos_urls deve ser uma lista de até 20 URLs.'),
    body('anexos_urls.*').optional().isURL({ require_protocol: true }).withMessage('cada item de anexos_urls deve ser uma URL válida.'),
    body('observacao').optional({ nullable: true, checkFalsy: true }).isLength({ max: 1000 }).withMessage('observacao deve ter no máximo 1000 caracteres.'),
    body('outras_pendencias_ids').optional({ nullable: true }).isArray({ max: 20 }).withMessage('outras_pendencias_ids deve ser uma lista de até 20 ids.'),
    body('outras_pendencias_ids.*').optional().isInt({ min: 1 }).withMessage('cada item de outras_pendencias_ids deve ser um id inteiro positivo.'),
  ],
  validate,
  controller.cobrarInadimplente.bind(controller)
);

router.post(
  '/inadimplencia/boletos/upload',
  auth,
  uploadDoc.single('arquivo'),
  validate,
  controller.uploadBoletoCobranca.bind(controller)
);

// Sem `auth` de propósito: aberta pelo morador direto do link do e-mail, sem login.
router.get(
  '/boletos/download',
  controller.downloadBoletoCobranca.bind(controller)
);

// ── Cobrança (log) ────────────────────────────────────────────────────────────

router.get(
  '/cobrancas',
  auth,
  [
    query('id_receita').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_receita deve ser inteiro positivo.'),
    query('id_usuario').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('id_usuario deve ser inteiro positivo.'),
    query('canal').optional({ nullable: true, checkFalsy: true }).isIn(['push', 'email', 'sms']).withMessage('canal inválido.'),
    query('data_inicio').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_inicio deve ser data válida.'),
    query('data_fim').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('data_fim deve ser data válida.'),
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
  ],
  validate,
  controller.listarCobrancaLog.bind(controller)
);

// ── Balancete ─────────────────────────────────────────────────────────────────

router.get(
  '/balancete',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.getBalancete.bind(controller)
);

router.post(
  '/balancete/publicar',
  auth,
  [
    body('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    body('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    body('enviar_email').optional({ nullable: true }).isIn([0, 1, '0', '1']).withMessage('enviar_email deve ser 0 ou 1.'),
    body('mensagem').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 1000 }).withMessage('mensagem deve ser texto com até 1000 caracteres.'),
  ],
  validate,
  controller.publicarBalancete.bind(controller)
);

// ── Documentos da competência ─────────────────────────────────────────────────

router.get(
  '/documentos',
  auth,
  [
    query('periodo').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('periodo deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    query('competencia').optional({ nullable: true, checkFalsy: true }).matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
  ],
  validate,
  controller.listarDocumentosCompetencia.bind(controller)
);

router.post(
  '/documentos',
  auth,
  uploadDoc.single('arquivo'),
  [
    body('competencia')
      .notEmpty().withMessage('competencia é obrigatório.')
      .bail()
      .matches(/^\d{4}-\d{2}(-\d{2})?$/).withMessage('competencia deve estar no formato YYYY-MM ou YYYY-MM-DD.'),
    body('tipo')
      .notEmpty().withMessage('tipo é obrigatório.')
      .bail()
      .isIn(['extrato_bancario', 'notas_fiscais', 'prestacao_assinada', 'outro']).withMessage('tipo inválido.'),
  ],
  validate,
  controller.uploadDocumentoCompetencia.bind(controller)
);

router.delete(
  '/documentos/:id',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.excluirDocumentoCompetencia.bind(controller)
);

router.get(
  '/documentos/download',
  auth,
  controller.downloadDocumentoFinanceiro.bind(controller)
);

// ── Documentos da receita ────────────────────────────────────────────────────

router.get(
  '/receitas/:id/documentos',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.listarDocumentosReceita.bind(controller)
);

router.post(
  '/receitas/:id/documentos',
  auth,
  uploadDoc.single('arquivo'),
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('tipo')
      .notEmpty().withMessage('tipo é obrigatório.')
      .bail()
      .isIn(['boleto', 'comprovante', 'outro']).withMessage('tipo inválido.'),
  ],
  validate,
  controller.uploadDocumentoReceita.bind(controller)
);

router.delete(
  '/receitas/:id/documentos/:docId',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    param('docId').isInt({ min: 1 }).withMessage('docId inválido.'),
  ],
  validate,
  controller.excluirDocumentoReceita.bind(controller)
);

// ── Fornecedores ──────────────────────────────────────────────────────────────

const camposFornecedorValidacao = [
  body('nome_fantasia').optional({ nullable: true, checkFalsy: true }).isLength({ max: 150 }).withMessage('nome_fantasia deve ter no máximo 150 caracteres.'),
  body('tipo_pessoa').optional().isIn(['F', 'J']).withMessage('tipo_pessoa deve ser F ou J.'),
  body('cpf_cnpj').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('cpf_cnpj deve ter no máximo 20 caracteres.'),
  body('inscricao_estadual').optional({ nullable: true, checkFalsy: true }).isLength({ max: 30 }).withMessage('inscricao_estadual deve ter no máximo 30 caracteres.'),
  body('inscricao_municipal').optional({ nullable: true, checkFalsy: true }).isLength({ max: 30 }).withMessage('inscricao_municipal deve ter no máximo 30 caracteres.'),
  body('telefone').optional({ nullable: true, checkFalsy: true }).isLength({ max: 30 }).withMessage('telefone deve ter no máximo 30 caracteres.'),
  body('celular').optional({ nullable: true, checkFalsy: true }).isLength({ max: 30 }).withMessage('celular deve ter no máximo 30 caracteres.'),
  body('whatsapp').optional({ nullable: true, checkFalsy: true }).isLength({ max: 30 }).withMessage('whatsapp deve ter no máximo 30 caracteres.'),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('email inválido.'),
  body('site').optional({ nullable: true, checkFalsy: true }).isLength({ max: 150 }).withMessage('site deve ter no máximo 150 caracteres.'),
  body('cep').optional({ nullable: true, checkFalsy: true }).isLength({ max: 10 }).withMessage('cep deve ter no máximo 10 caracteres.'),
  body('endereco').optional({ nullable: true, checkFalsy: true }).isLength({ max: 200 }).withMessage('endereco deve ter no máximo 200 caracteres.'),
  body('numero').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('numero deve ter no máximo 20 caracteres.'),
  body('complemento').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('complemento deve ter no máximo 100 caracteres.'),
  body('bairro').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('bairro deve ter no máximo 100 caracteres.'),
  body('cidade').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('cidade deve ter no máximo 100 caracteres.'),
  body('estado').optional({ nullable: true, checkFalsy: true }).isLength({ min: 2, max: 2 }).withMessage('estado deve ter 2 caracteres.'),
  body('banco').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('banco deve ter no máximo 100 caracteres.'),
  body('agencia').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('agencia deve ter no máximo 20 caracteres.'),
  body('conta').optional({ nullable: true, checkFalsy: true }).isLength({ max: 30 }).withMessage('conta deve ter no máximo 30 caracteres.'),
  body('tipo_conta').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('tipo_conta deve ter no máximo 20 caracteres.'),
  body('chave_pix').optional({ nullable: true, checkFalsy: true }).isLength({ max: 150 }).withMessage('chave_pix deve ter no máximo 150 caracteres.'),
  body('tipo_pix').optional({ nullable: true, checkFalsy: true }).isLength({ max: 20 }).withMessage('tipo_pix deve ter no máximo 20 caracteres.'),
  body('observacao').optional({ nullable: true }),
  body('categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('categoria deve ter no máximo 100 caracteres.'),
];

router.get(
  '/fornecedores',
  auth,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page deve ser inteiro maior que zero.'),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).withMessage('pageSize deve estar entre 1 e 200.'),
    query('categoria').optional({ nullable: true, checkFalsy: true }).isLength({ max: 100 }).withMessage('categoria deve ter no máximo 100 caracteres.'),
    query('tipo_pessoa').optional({ nullable: true, checkFalsy: true }).isIn(['F', 'J']).withMessage('tipo_pessoa deve ser F ou J.'),
    query('ativo').optional({ nullable: true, checkFalsy: true }).isBoolean().withMessage('ativo deve ser true ou false.'),
    query('busca').optional({ nullable: true, checkFalsy: true }).isLength({ max: 150 }).withMessage('busca deve ter no máximo 150 caracteres.'),
  ],
  validate,
  controller.listarFornecedores.bind(controller)
);

router.get(
  '/fornecedores/:id',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.obterFornecedor.bind(controller)
);

router.post(
  '/fornecedores',
  auth,
  [
    body('nome').notEmpty().withMessage('nome é obrigatório.').bail().isLength({ max: 150 }).withMessage('nome deve ter no máximo 150 caracteres.'),
    ...camposFornecedorValidacao,
  ],
  validate,
  controller.criarFornecedor.bind(controller)
);

router.put(
  '/fornecedores/:id',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('nome').optional().isLength({ max: 150 }).withMessage('nome deve ter no máximo 150 caracteres.'),
    ...camposFornecedorValidacao,
  ],
  validate,
  controller.atualizarFornecedor.bind(controller)
);

router.patch(
  '/fornecedores/:id/ativo',
  auth,
  [
    param('id').isInt({ min: 1 }).withMessage('id inválido.'),
    body('ativo').notEmpty().withMessage('ativo é obrigatório.').bail().isBoolean().withMessage('ativo deve ser true ou false.'),
  ],
  validate,
  controller.atualizarStatusFornecedor.bind(controller)
);

router.delete(
  '/fornecedores/:id',
  auth,
  [param('id').isInt({ min: 1 }).withMessage('id inválido.')],
  validate,
  controller.excluirFornecedor.bind(controller)
);

module.exports = router;
