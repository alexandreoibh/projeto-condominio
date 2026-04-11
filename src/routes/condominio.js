const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { body, param, query } = require('express-validator');
const CondominioController = require('../controllers/condominioController');
const auth = require('../helpers/auth');
const validate = require('../helpers/validate');

const controller = new CondominioController();

const publicRegistrationKeyGuard = (req, res, next) => {
	const expectedKey = process.env.PUBLIC_REGISTRATION_KEY;
	const providedKey =
		req.header('X-Public-Registration-Key') ||
		req.header('x-api-key') ||
		req.header('X-API-Key');

	if (!expectedKey || !providedKey) {
		return res.status(401).json({ message: 'Não autorizado.' });
	}

	const expectedBuffer = Buffer.from(String(expectedKey));
	const providedBuffer = Buffer.from(String(providedKey));

	if (
		expectedBuffer.length !== providedBuffer.length ||
		!crypto.timingSafeEqual(expectedBuffer, providedBuffer)
	) {
		return res.status(401).json({ message: 'Não autorizado.' });
	}

	return next();
};

const authOrInviteToken = (req, res, next) => {
	const inviteToken =
		req.body?.invite_token ||
		req.body?.token ||
		req.query?.invite_token ||
		req.query?.token ||
		req.header('x-invite-token') ||
		req.header('X-Invite-Token') ||
		req.header('invite-token') ||
		req.header('Invite-Token');

	if (inviteToken && String(inviteToken).trim() !== '') {
		return next();
	}

	return auth(req, res, next);
};

router.get('/status', controller.status.bind(controller));
router.get(
	'/fatura/planos',
	auth,
	[
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isIn(['true', 'false', '1', '0'])
			.withMessage('Parâmetro ativo deve ser true, false, 1 ou 0.')
	],
	validate,
	controller.listarFaturaPlanos.bind(controller)
);
router.get(
	'/fatura/lancamentos',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 500 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 500.'),
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('id_fatura')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_fatura deve ser numérico e maior que zero.'),
		query('id_plano')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_plano deve ser numérico e maior que zero.'),
		query('referencia')
			.optional({ nullable: true, checkFalsy: true })
			.matches(/^\d{4}-\d{2}$/)
			.withMessage('Parâmetro referencia deve estar no formato YYYY-MM.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('data_vencimento_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro data_vencimento_inicio deve estar em formato de data válido.'),
		query('data_vencimento_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro data_vencimento_fim deve estar em formato de data válido.'),
		query('vencimento_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro vencimento_inicio deve estar em formato de data válido.'),
		query('vencimento_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro vencimento_fim deve estar em formato de data válido.')
	],
	validate,
	controller.listarFaturasPagamentos.bind(controller)
);
router.get(
	'/fatura/pendencias/resumo',
	auth,
	[
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('limit')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1, max: 20 })
			.withMessage('Parâmetro limit deve estar entre 1 e 20.')
	],
	validate,
	controller.resumoFaturasPendentes.bind(controller)
);
router.put(
	'/fatura/planos/condominio',
	auth,
	[
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('id_plano')
			.notEmpty()
			.withMessage('Campo id_plano é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_plano deve ser numérico e maior que zero.'),
		body('data_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo data_inicio deve estar em formato de data válido.'),
		body('data_fim_anterior')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo data_fim_anterior deve estar em formato de data válido.'),
		body('observacao')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 1250 })
			.withMessage('Campo observacao deve ter no máximo 1250 caracteres.')
	],
	validate,
	controller.atualizarFaturaPlanoCondominio.bind(controller)
);
router.get('/consumo/tipos/ativos', auth, controller.listarConsumoTiposAtivos.bind(controller));
router.get(
	'/consumo/registros',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro pageSize deve ser numérico e maior que zero.'),
		query('id_tipo_consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_consumo deve ser numérico e maior que zero.'),
		query('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario deve ser numérico e maior que zero.'),
		query('competencia')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro competencia deve estar em formato de data válido.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('unidade')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Parâmetro unidade deve ter no máximo 120 caracteres.'),
		query('morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Parâmetro morador deve ter no máximo 120 caracteres.'),
		query('periodo_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_inicio deve estar em formato de data válido.'),
		query('periodoInicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodoInicio deve estar em formato de data válido.'),
		query('periodo_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_fim deve estar em formato de data válido.'),
		query('periodoFim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodoFim deve estar em formato de data válido.')
	],
	validate,
	controller.listarConsumoRegistros.bind(controller)
);
router.get(
	'/consumo/registros/resumo/moradores',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro pageSize deve ser numérico e maior que zero.'),
		query('morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Parâmetro morador deve ter no máximo 120 caracteres.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('id_tipo_consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_consumo deve ser numérico e maior que zero.'),
		query('periodo_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_inicio deve estar em formato de data válido.'),
		query('periodoInicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodoInicio deve estar em formato de data válido.'),
		query('periodo_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_fim deve estar em formato de data válido.'),
		query('periodoFim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodoFim deve estar em formato de data válido.')
	],
	validate,
	controller.listarConsumoResumoPorMorador.bind(controller)
);
router.get(
	'/consumo/registros/resumo/unidades/:id_unidade(\\d+)',
	auth,
	[
		param('id_unidade').isInt({ min: 1 }).withMessage('Parâmetro id_unidade inválido.'),
		query('morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Parâmetro morador deve ter no máximo 120 caracteres.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('id_tipo_consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_consumo deve ser numérico e maior que zero.')
	],
	validate,
	controller.buscarConsumoResumoPorIdUnidade.bind(controller)
);
router.get(
	'/consumo/registros/unidades/:id_unidade(\\d+)',
	auth,
	[
		param('id_unidade').isInt({ min: 1 }).withMessage('Parâmetro id_unidade inválido.'),
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro pageSize deve ser numérico e maior que zero.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('competencia')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro competencia deve estar em formato de data válido.'),
		query('id_tipo_consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_consumo deve ser numérico e maior que zero.')
	],
	validate,
	controller.listarLancamentosConsumoPorUnidade.bind(controller)
);
router.get(
	'/consumo/registros/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarConsumoRegistroPorId.bind(controller)
);
router.post(
	'/consumo/registros',
	auth,
	[
		body('id_tipo_consumo')
			.notEmpty()
			.withMessage('Campo id_tipo_consumo é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_tipo_consumo deve ser numérico e maior que zero.'),
		body('id_condominio')
			.notEmpty()
			.withMessage('Campo id_condominio é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('id_usuario')
			.notEmpty()
			.withMessage('Campo id_usuario é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_usuario deve ser numérico e maior que zero.'),
		body('leitura_atual')
			.notEmpty()
			.withMessage('Campo leitura_atual é obrigatório.')
			.bail()
			.isFloat()
			.withMessage('Campo leitura_atual deve ser numérico.'),
		body('competencia')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo competencia deve estar em formato de data válido.'),
		body('leitura_anterior')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo leitura_anterior deve ser numérico.'),
		body('consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo consumo deve ser numérico.'),
		body('valor_unitario')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo valor_unitario deve ser numérico.'),
		body('valor_total')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo valor_total deve ser numérico.'),
		body('cobr_valor_minimo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo cobr_valor_minimo deve ser booleano.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo status deve ter no máximo 20 caracteres.')
	],
	validate,
	controller.criarConsumoRegistro.bind(controller)
);
router.put(
	'/consumo/registros/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('id_tipo_consumo')
			.notEmpty()
			.withMessage('Campo id_tipo_consumo é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_tipo_consumo deve ser numérico e maior que zero.'),
		body('id_condominio')
			.notEmpty()
			.withMessage('Campo id_condominio é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('id_usuario')
			.notEmpty()
			.withMessage('Campo id_usuario é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo id_usuario deve ser numérico e maior que zero.'),
		body('leitura_atual')
			.notEmpty()
			.withMessage('Campo leitura_atual é obrigatório.')
			.bail()
			.isFloat()
			.withMessage('Campo leitura_atual deve ser numérico.'),
		body('competencia')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo competencia deve estar em formato de data válido.'),
		body('leitura_anterior')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo leitura_anterior deve ser numérico.'),
		body('consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo consumo deve ser numérico.'),
		body('valor_unitario')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo valor_unitario deve ser numérico.'),
		body('valor_total')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo valor_total deve ser numérico.'),
		body('cobr_valor_minimo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo cobr_valor_minimo deve ser booleano.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo status deve ter no máximo 20 caracteres.')
	],
	validate,
	controller.editarConsumoRegistro.bind(controller)
);
router.patch(
	'/consumo/registros/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body().custom((value, { req }) => {
			const camposPermitidos = [
				'id_tipo_consumo',
				'id_condominio',
				'id_usuario',
				'competencia',
				'leitura_anterior',
				'leitura_atual',
				'consumo',
				'valor_unitario',
				'valor_total',
				'cobr_valor_minimo',
				'observacao',
				'status',
				'origem_imagem'
			];

			const possuiCampo = camposPermitidos.some((campo) => req.body[campo] !== undefined);
			if (!possuiCampo) {
				throw new Error('Informe ao menos um campo para atualização.');
			}

			return true;
		}),
		body('id_tipo_consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_tipo_consumo deve ser numérico e maior que zero.'),
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_usuario deve ser numérico e maior que zero.'),
		body('competencia')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo competencia deve estar em formato de data válido.'),
		body('leitura_anterior')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo leitura_anterior deve ser numérico.'),
		body('leitura_atual')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo leitura_atual deve ser numérico.'),
		body('consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo consumo deve ser numérico.'),
		body('valor_unitario')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo valor_unitario deve ser numérico.'),
		body('valor_total')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat()
			.withMessage('Campo valor_total deve ser numérico.'),
		body('cobr_valor_minimo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo cobr_valor_minimo deve ser booleano.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo status deve ter no máximo 20 caracteres.')
	],
	validate,
	controller.atualizarParcialConsumoRegistro.bind(controller)
);
router.get('/perfis', auth, controller.listarPerfis.bind(controller));
router.get(
	'/menu/perfis/configuracao',
	auth,
	[
		query('id_perfil')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_perfil inválido.')
	],
	validate,
	controller.listarConfiguracaoPermissoesMenu.bind(controller)
);
router.get(
	'/menu/perfis/:id_perfil(\\d+)/permissoes',
	auth,
	[param('id_perfil').isInt({ min: 1 }).withMessage('Parâmetro id_perfil inválido.')],
	validate,
	controller.listarPermissoesMenuPorPerfil.bind(controller)
);
router.put(
	'/menu/perfis/:id_perfil(\\d+)/permissoes',
	auth,
	[
		param('id_perfil').isInt({ min: 1 }).withMessage('Parâmetro id_perfil inválido.'),
		body('permissoes')
			.isArray()
			.withMessage('Campo permissoes deve ser um array.'),
		body('permissoes.*.id_menu')
			.isInt({ min: 1 })
			.withMessage('Campo permissoes[].id_menu deve ser numérico e maior que zero.'),
		body('permissoes.*.pode_ver')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo permissoes[].pode_ver deve ser booleano.'),
		body('permissoes.*.pode_criar')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo permissoes[].pode_criar deve ser booleano.'),
		body('permissoes.*.pode_editar')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo permissoes[].pode_editar deve ser booleano.'),
		body('permissoes.*.pode_excluir')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo permissoes[].pode_excluir deve ser booleano.')
	],
	validate,
	controller.substituirPermissoesMenuPorPerfil.bind(controller)
);
router.get(
	'/condominios',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 500 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 500.'),
		query('q')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Parâmetro q deve ter no máximo 120 caracteres.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isBoolean()
			.withMessage('Parâmetro ativo deve ser booleano.')
	],
	validate,
	controller.listarCondominios.bind(controller)
);
router.get(
	'/condominios/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarCondominioPorId.bind(controller)
);
router.post(
	'/condominios',
	auth,
	[
		body().custom((value, { req }) => {
			const qtdeBlocos = req.body.qtde_blocos !== undefined ? req.body.qtde_blocos : req.body.qtde_bloco;
			if (qtdeBlocos === undefined || qtdeBlocos === null || String(qtdeBlocos).trim() === '') {
				throw new Error('Campo qtde_blocos é obrigatório.');
			}
			return true;
		}),
		body('nome')
			.notEmpty()
			.withMessage('Campo nome é obrigatório.')
			.bail()
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('email')
			.notEmpty()
			.withMessage('Campo email é obrigatório.')
			.bail()
			.isEmail()
			.withMessage('Campo email inválido.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo email deve ter no máximo 255 caracteres.'),
		body('telefone')
			.notEmpty()
			.withMessage('Campo telefone é obrigatório.')
			.bail()
			.isLength({ max: 20 })
			.withMessage('Campo telefone deve ter no máximo 20 caracteres.'),
		body('qtde_ap_andar')
			.notEmpty()
			.withMessage('Campo qtde_ap_andar é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo qtde_ap_andar deve ser numérico e maior que zero.'),
		body('escrita_bloco')
			.notEmpty()
			.withMessage('Campo escrita_bloco é obrigatório.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo escrita_bloco deve ter no máximo 255 caracteres.'),
		body('qtde_ap_bloco')
			.notEmpty()
			.withMessage('Campo qtde_ap_bloco é obrigatório.')
			.bail()
			.isInt({ min: 1 })
			.withMessage('Campo qtde_ap_bloco deve ser numérico e maior que zero.'),
		body('qtde_blocos')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_blocos deve ser numérico e maior que zero.'),
		body('qtde_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_bloco deve ser numérico e maior que zero.'),
		body('unidades_bloco')
			.isArray({ min: 1 })
			.withMessage('Campo unidades_bloco é obrigatório e deve ser um array com ao menos 1 item.'),
		body('unidades_bloco.*')
			.notEmpty()
			.withMessage('Cada item de unidades_bloco deve ser informado.')
			.bail()
			.isLength({ max: 50 })
			.withMessage('Cada item de unidades_bloco deve ter no máximo 50 caracteres.'),
		body('cnpj')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cnpj = String(value).replace(/\D/g, '');
				if (cnpj.length > 14) {
					throw new Error('Campo cnpj deve ter no máximo 14 dígitos.');
				}
				return true;
			}),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.'),
		body('modelo_fatura')
			.notEmpty()
			.withMessage('Campo modelo_fatura é obrigatório.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo modelo_fatura deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.criarCondominio.bind(controller)
);
router.put(
	'/condominios/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('nome')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('email')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Campo email inválido.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo email deve ter no máximo 255 caracteres.'),
		body('telefone')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo telefone deve ter no máximo 20 caracteres.'),
		body('qtde_ap_andar')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_ap_andar deve ser numérico e maior que zero.'),
		body('escrita_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo escrita_bloco deve ter no máximo 255 caracteres.'),
		body('qtde_ap_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_ap_bloco deve ser numérico e maior que zero.'),
		body('qtde_blocos')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_blocos deve ser numérico e maior que zero.'),
		body('qtde_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_bloco deve ser numérico e maior que zero.'),
		body('unidades_bloco')
			.optional({ nullable: true })
			.isArray({ min: 1 })
			.withMessage('Campo unidades_bloco deve ser um array com ao menos 1 item.'),
		body('unidades_bloco.*')
			.optional({ nullable: true })
			.notEmpty()
			.withMessage('Cada item de unidades_bloco deve ser informado.')
			.bail()
			.isLength({ max: 50 })
			.withMessage('Cada item de unidades_bloco deve ter no máximo 50 caracteres.'),
		body('cnpj')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cnpj = String(value).replace(/\D/g, '');
				if (cnpj.length > 14) {
					throw new Error('Campo cnpj deve ter no máximo 14 dígitos.');
				}
				return true;
			}),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.'),
		body('modelo_fatura')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo modelo_fatura deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.editarCondominio.bind(controller)
);
router.patch(
	'/condominios/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('nome')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('email')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Campo email inválido.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo email deve ter no máximo 255 caracteres.'),
		body('telefone')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo telefone deve ter no máximo 20 caracteres.'),
		body('qtde_ap_andar')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_ap_andar deve ser numérico e maior que zero.'),
		body('escrita_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo escrita_bloco deve ter no máximo 255 caracteres.'),
		body('qtde_ap_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_ap_bloco deve ser numérico e maior que zero.'),
		body('qtde_blocos')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_blocos deve ser numérico e maior que zero.'),
		body('qtde_bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo qtde_bloco deve ser numérico e maior que zero.'),
		body('unidades_bloco')
			.optional({ nullable: true })
			.isArray({ min: 1 })
			.withMessage('Campo unidades_bloco deve ser um array com ao menos 1 item.'),
		body('unidades_bloco.*')
			.optional({ nullable: true })
			.notEmpty()
			.withMessage('Cada item de unidades_bloco deve ser informado.')
			.bail()
			.isLength({ max: 50 })
			.withMessage('Cada item de unidades_bloco deve ter no máximo 50 caracteres.'),
		body('cnpj')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cnpj = String(value).replace(/\D/g, '');
				if (cnpj.length > 14) {
					throw new Error('Campo cnpj deve ter no máximo 14 dígitos.');
				}
				return true;
			}),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.'),
		body('modelo_fatura')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo modelo_fatura deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.editarCondominio.bind(controller)
);
router.get('/menu', auth, controller.listarMenuDinamico.bind(controller));
router.get('/dashboard/tipos', auth, controller.listarDashboardTipos.bind(controller));
router.get('/dashboard/empresas', auth, controller.listarDashboardEmpresas.bind(controller));
router.get('/dashboard/titulos', auth, controller.listarDashboardTitulos.bind(controller));
router.get(
	'/dashboard/titulos/:id_tipo(\\d+)',
	auth,
	[param('id_tipo').isInt({ min: 1 }).withMessage('Parâmetro id_tipo inválido.')],
	validate,
	controller.listarDashboardTitulosPorTipo.bind(controller)
);
router.get(
	'/dashboard/tipos/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarDashboardTipoPorId.bind(controller)
);
router.post(
	'/dashboard/tipos',
	auth,
	[
		body('codigo')
			.notEmpty()
			.withMessage('Campo codigo é obrigatório.')
			.bail()
			.isLength({ max: 30 })
			.withMessage('Campo codigo deve ter no máximo 30 caracteres.'),
		body('descricao')
			.notEmpty()
			.withMessage('Campo descricao é obrigatório.')
			.bail()
			.isLength({ max: 100 })
			.withMessage('Campo descricao deve ter no máximo 100 caracteres.'),
		body('status')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo status deve ser booleano.')
	],
	validate,
	controller.criarDashboardTipo.bind(controller)
);
router.put(
	'/dashboard/tipos/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('codigo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Campo codigo deve ter no máximo 30 caracteres.'),
		body('descricao')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo descricao deve ter no máximo 100 caracteres.'),
		body('status')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo status deve ser booleano.')
	],
	validate,
	controller.editarDashboardTipo.bind(controller)
);
router.delete(
	'/dashboard/tipos/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.excluirDashboardTipo.bind(controller)
);

router.get(
	'/dashboard/registros',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 500 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 500.'),
		query('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Parâmetro tipo deve ser numérico.'),
		query('exibicao_dashboard')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Parâmetro exibicao_dashboard deve ser 0 ou 1.')
	],
	validate,
	controller.listarDashboardRegistros.bind(controller)
);
router.get(
	'/dashboard/registros/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarDashboardRegistroPorId.bind(controller)
);
router.post(
	'/dashboard/registros',
	auth,
	[
		body('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Campo tipo deve ser numérico.'),
		body('titulo')
			.notEmpty()
			.withMessage('Campo titulo é obrigatório.')
			.bail()
			.isLength({ max: 200 })
			.withMessage('Campo titulo deve ter no máximo 200 caracteres.'),
		body('descricao')
			.optional({ nullable: true })
			.isLength({ max: 1500 })
			.withMessage('Campo descricao deve ter no máximo 1500 caracteres.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Campo status deve ter no máximo 30 caracteres.'),
		body('prioridade')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Campo prioridade deve ser numérico.'),
		body('exibicao_dashboard')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo exibicao_dashboard deve ser 0 ou 1.'),
		body('apartamento')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo apartamento deve ter no máximo 50 caracteres.'),
		body('bloco')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.'),
		body('empresa_entrega')
			.optional({ nullable: true })
			.isLength({ max: 255 })
			.withMessage('Campo empresa_entrega deve ter no máximo 255 caracteres.'),
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('condominio_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo condominio_id deve ser numérico e maior que zero.'),
		body('encomenda_condominio_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo encomenda_condominio_id deve ser numérico e maior que zero.'),
		body('encomenda_apartamento')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo encomenda_apartamento deve ter no máximo 50 caracteres.'),
		body('encomenda_bloco')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo encomenda_bloco deve ter no máximo 50 caracteres.')
	],
	validate,
	controller.criarDashboardRegistro.bind(controller)
);
router.put(
	'/dashboard/registros/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Campo tipo deve ser numérico.'),
		body('titulo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 200 })
			.withMessage('Campo titulo deve ter no máximo 200 caracteres.'),
		body('descricao')
			.optional({ nullable: true })
			.isLength({ max: 1500 })
			.withMessage('Campo descricao deve ter no máximo 1500 caracteres.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Campo status deve ter no máximo 30 caracteres.'),
		body('prioridade')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Campo prioridade deve ser numérico.'),
		body('exibicao_dashboard')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo exibicao_dashboard deve ser 0 ou 1.'),
		body('apartamento')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo apartamento deve ter no máximo 50 caracteres.'),
		body('bloco')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.'),
		body('empresa_entrega')
			.optional({ nullable: true })
			.isLength({ max: 255 })
			.withMessage('Campo empresa_entrega deve ter no máximo 255 caracteres.'),
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('condominio_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo condominio_id deve ser numérico e maior que zero.'),
		body('encomenda_condominio_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo encomenda_condominio_id deve ser numérico e maior que zero.'),
		body('encomenda_apartamento')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo encomenda_apartamento deve ter no máximo 50 caracteres.'),
		body('encomenda_bloco')
			.optional({ nullable: true })
			.isLength({ max: 50 })
			.withMessage('Campo encomenda_bloco deve ter no máximo 50 caracteres.')
	],
	validate,
	controller.editarDashboardRegistro.bind(controller)
);
router.delete(
	'/dashboard/registros/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.excluirDashboardRegistro.bind(controller)
);

router.get(
	'/relatorios/envio-config',
	authOrInviteToken,
	[
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isIn(['true', 'false', '1', '0'])
			.withMessage('Parâmetro ativo deve ser true, false, 1 ou 0.')
	],
	validate,
	controller.listarRelEnvioConfig.bind(controller)
);

router.post(
	'/relatorios/envio-config',
	authOrInviteToken,
	[
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('dia_envio')
			.notEmpty()
			.withMessage('Campo dia_envio é obrigatório.')
			.bail()
			.isInt({ min: 1, max: 31 })
			.withMessage('Campo dia_envio deve ser numérico entre 1 e 31.'),
		body('horario_envio')
			.notEmpty()
			.withMessage('Campo horario_envio é obrigatório.')
			.bail()
			.matches(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/)
			.withMessage('Campo horario_envio deve estar no formato HH:mm ou HH:mm:ss.'),
		body('emails_destinatarios')
			.optional({ nullable: true })
			.isArray({ min: 1 })
			.withMessage('Campo emails_destinatarios deve ser um array de e-mails.'),
		body('emails_destinatarios.*')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Cada item de emails_destinatarios deve ser um e-mail válido.'),
		body('relatorio')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo relatorio deve ter no máximo 255 caracteres.'),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.')
	],
	validate,
	controller.criarRelEnvioConfig.bind(controller)
);

router.patch(
	'/relatorios/envio-config/:id(\\d+)',
	authOrInviteToken,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('dia_envio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1, max: 31 })
			.withMessage('Campo dia_envio deve ser numérico entre 1 e 31.'),
		body('horario_envio')
			.optional({ nullable: true, checkFalsy: true })
			.matches(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/)
			.withMessage('Campo horario_envio deve estar no formato HH:mm ou HH:mm:ss.'),
		body('emails_destinatarios')
			.optional({ nullable: true })
			.isArray()
			.withMessage('Campo emails_destinatarios deve ser um array de e-mails.'),
		body('emails_destinatarios.*')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Cada item de emails_destinatarios deve ser um e-mail válido.'),
		body('relatorio')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo relatorio deve ter no máximo 255 caracteres.'),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.')
	],
	validate,
	controller.atualizarRelEnvioConfig.bind(controller)
);

router.delete(
	'/relatorios/envio-config/:id(\\d+)',
	authOrInviteToken,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.excluirRelEnvioConfig.bind(controller)
);

router.get(
	'/relatorios/envio-log',
	authOrInviteToken,
	[
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('id_relatorio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_relatorio deve ser numérico e maior que zero.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('data_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro data_inicio deve estar em formato de data válido.'),
		query('data_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro data_fim deve estar em formato de data válido.'),
		query('periodo_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_inicio deve estar em formato de data válido.'),
		query('periodo_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_fim deve estar em formato de data válido.'),
		query('page')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1, max: 200 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 200.')
	],
	validate,
	controller.listarRelEnvioLog.bind(controller)
);

router.post(
	'/relatorios/envio-log',
	authOrInviteToken,
	[
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('id_relatorio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_relatorio deve ser numérico e maior que zero.'),
		body('data_envio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo data_envio deve estar em formato de data válido.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo status deve ter no máximo 20 caracteres.'),
		body('mensagem')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 5000 })
			.withMessage('Campo mensagem deve ter no máximo 5000 caracteres.')
	],
	validate,
	controller.criarRelEnvioLog.bind(controller)
);

router.get(
	'/regulamentos',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isBoolean()
			.withMessage('Parâmetro ativo deve ser booleano.')
			.toBoolean(),
		query('q')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 200 })
			.withMessage('Parâmetro q deve ter no máximo 200 caracteres.')
	],
	validate,
	controller.listarRegulamentos.bind(controller)
);

router.get(
	'/regulamentos/ativo',
	auth,
	controller.buscarRegulamentoAtivo.bind(controller)
);

router.get(
	'/regulamentos/aceites',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('id_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_regulamento deve ser numérico e maior que zero.'),
		query('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario deve ser numérico e maior que zero.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isBoolean()
			.withMessage('Parâmetro ativo deve ser booleano.')
			.toBoolean()
	],
	validate,
	controller.listarAceitesRegulamento.bind(controller)
);

router.get(
	'/regulamentos/aceites/ativo',
	auth,
	controller.buscarAceiteRegulamentoAtivo.bind(controller)
);

router.get(
	'/regulamentos/aceites/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarAceiteRegulamentoPorId.bind(controller)
);

router.post(
	'/regulamentos/aceites',
	auth,
	[
		body('id_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_regulamento deve ser numérico e maior que zero.')
	],
	validate,
	controller.registrarAceiteRegulamentoAtivo.bind(controller)
);

router.put(
	'/regulamentos/aceites/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('id_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_regulamento deve ser numérico e maior que zero.'),
		body('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_usuario deve ser numérico e maior que zero.'),
		body('aceito_em')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Campo aceito_em deve estar em formato de data válido.'),
		body('ip')
			.optional({ nullable: true })
			.isLength({ max: 64 })
			.withMessage('Campo ip deve ter no máximo 64 caracteres.')
	],
	validate,
	controller.editarAceiteRegulamento.bind(controller)
);

router.delete(
	'/regulamentos/aceites/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.excluirAceiteRegulamento.bind(controller)
);

router.get(
	'/regulamentos/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarRegulamentoPorId.bind(controller)
);

router.post(
	'/regulamentos',
	auth,
	[
		body('titulo')
			.notEmpty()
			.withMessage('Campo titulo é obrigatório.')
			.bail()
			.isLength({ max: 150 })
			.withMessage('Campo titulo deve ter no máximo 150 caracteres.'),
		body('documento_salvo')
			.optional({ nullable: true })
			.isLength({ max: 255 })
			.withMessage('Campo documento_salvo deve ter no máximo 255 caracteres.'),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.'),
		body('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 150 })
			.withMessage('Campo tipo deve ter no máximo 150 caracteres.'),
		body('tipo_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 150 })
			.withMessage('Campo tipo_regulamento deve ter no máximo 150 caracteres.'),
		body('descricao_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo descricao_regulamento deve ter no máximo 255 caracteres.'),
		body('observacao')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 4000 })
			.withMessage('Campo observacao deve ter no máximo 4000 caracteres.')
	],
	validate,
	controller.criarRegulamento.bind(controller)
);

router.put(
	'/regulamentos/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('titulo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 150 })
			.withMessage('Campo titulo deve ter no máximo 150 caracteres.'),
		body('documento_salvo')
			.optional({ nullable: true })
			.isLength({ max: 255 })
			.withMessage('Campo documento_salvo deve ter no máximo 255 caracteres.'),
		body('ativo')
			.optional({ nullable: true })
			.isBoolean()
			.withMessage('Campo ativo deve ser booleano.'),
		body('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 150 })
			.withMessage('Campo tipo deve ter no máximo 150 caracteres.'),
		body('tipo_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 150 })
			.withMessage('Campo tipo_regulamento deve ter no máximo 150 caracteres.'),
		body('descricao_regulamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo descricao_regulamento deve ter no máximo 255 caracteres.'),
		body('observacao')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 4000 })
			.withMessage('Campo observacao deve ter no máximo 4000 caracteres.')
	],
	validate,
	controller.editarRegulamento.bind(controller)
);

router.delete(
	'/regulamentos/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.excluirRegulamento.bind(controller)
);

router.get(
	'/relatorios-export-pdf.php',
	auth,
	[
		query('modulo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 80 })
			.withMessage('Parâmetro modulo deve ter no máximo 80 caracteres.'),
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 500 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 500.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Parâmetro status deve ter no máximo 30 caracteres.'),
		query('periodo_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_inicio deve estar em formato de data válido.'),
		query('periodo_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_fim deve estar em formato de data válido.'),
		query('id_tipo_consumo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_consumo deve ser numérico e maior que zero.'),
		query('id_espaco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_espaco deve ser numérico e maior que zero.'),
		query('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario deve ser numérico e maior que zero.'),
		query('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro tipo deve ser numérico e maior que zero.'),
		query('id_tipo_dashboard')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_dashboard deve ser numérico e maior que zero.'),
		query('id_usuario_lancamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario_lancamento deve ser numérico e maior que zero.'),
		query('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const tipo = String(value || '').trim().toLowerCase();
				if (tipo === '' || ['proprietario', 'inquilino'].includes(tipo)) {
					return true;
				}
				throw new Error('Parâmetro tipo_morador deve ser proprietario ou inquilino.');
			}),
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.')
	],
	validate,
	controller.relatorioExportPdf.bind(controller)
);

router.get(
	'/relatorios/comunicacoes',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 500 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 500.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Parâmetro status deve ter no máximo 100 caracteres.'),
		query('periodo_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_inicio deve estar em formato de data válido.'),
		query('periodo_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_fim deve estar em formato de data válido.'),
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('tipo')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro tipo deve ser numérico e maior que zero.'),
		query('id_tipo_dashboard')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_tipo_dashboard deve ser numérico e maior que zero.'),
		query('id_usuario_lancamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario_lancamento deve ser numérico e maior que zero.'),
		query('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario deve ser numérico e maior que zero.')
	],
	validate,
	controller.relatorioComunicacoes.bind(controller)
);

router.get(
	'/relatorios/reservas',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 500 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 500.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Parâmetro status deve ter no máximo 30 caracteres.'),
		query('periodo_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_inicio deve estar em formato de data válido.'),
		query('periodo_fim')
			.optional({ nullable: true, checkFalsy: true })
			.isISO8601()
			.withMessage('Parâmetro periodo_fim deve estar em formato de data válido.'),
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('id_espaco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_espaco deve ser numérico e maior que zero.'),
		query('id_usuario')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_usuario deve ser numérico e maior que zero.')
	],
	validate,
	controller.relatorioReservas.bind(controller)
);

router.get(
	'/relatorios/usuarios',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Parâmetro status deve ter no máximo 30 caracteres.'),
		query('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const tipo = String(value || '').trim().toLowerCase();
				if (tipo === '' || ['proprietario', 'inquilino'].includes(tipo)) {
					return true;
				}
				throw new Error('Parâmetro tipo_morador deve ser proprietario ou inquilino.');
			}),
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.')
	],
	validate,
	controller.relatorioUsuarios.bind(controller)
);

router.get(
	'/moradores',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('nome')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Parâmetro nome deve ter no máximo 255 caracteres.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Parâmetro status deve ter no máximo 30 caracteres.'),
		query('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Parâmetro tipo_morador deve ter no máximo 100 caracteres.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isBoolean()
			.withMessage('Parâmetro ativo deve ser booleano.')
	],
	validate,
	controller.listarMoradores.bind(controller)
);

router.get(
	'/usuarios',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('nome')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Parâmetro nome deve ter no máximo 255 caracteres.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 30 })
			.withMessage('Parâmetro status deve ter no máximo 30 caracteres.'),
		query('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Parâmetro tipo_morador deve ter no máximo 100 caracteres.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isBoolean()
			.withMessage('Parâmetro ativo deve ser booleano.')
	],
	validate,
	controller.listarMoradores.bind(controller)
);

router.get(
	'/usuarios/por-perfis',
	auth,
	[
		query('perfil_ids')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const valores = String(value || '')
					.split(',')
					.map((item) => item.trim())
					.filter((item) => item !== '');

				if (valores.length === 0) {
					throw new Error('Parâmetro perfil_ids deve conter ao menos um id de perfil.');
				}

				const todosValidos = valores.every((item) => /^\d+$/.test(item) && Number(item) > 0);
				if (!todosValidos) {
					throw new Error('Parâmetro perfil_ids deve conter ids numéricos positivos separados por vírgula.');
				}

				return true;
			})
	],
	validate,
	controller.listarUsuariosPorPerfis.bind(controller)
);

router.get(
	'/usuarios/condominio/:id_condominio(\\d+)',
	auth,
	[
		param('id_condominio').isInt({ min: 1 }).withMessage('Parâmetro id_condominio inválido.'),
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.')
	],
	validate,
	controller.listarUsuariosPorCondominio.bind(controller)
);

router.get(
	'/usuarios/base',
	auth,
	[
		query('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_condominio deve ser numérico e maior que zero.'),
		query('bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Parâmetro bloco deve ter no máximo 50 caracteres.'),
		query('apartamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Parâmetro apartamento deve ter no máximo 50 caracteres.')
	],
	validate,
	controller.consultarUsuariosBase.bind(controller)
);

router.get(
	'/usuarios/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarUsuarioPorId.bind(controller)
);

router.post(
	'/auth-recovery-lookup',
	[
		body('login')
			.notEmpty()
			.withMessage('Campo login é obrigatório.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo login deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.authRecoveryLookup.bind(controller)
);

router.post(
	'/auth-recovery-lookup.php',
	[
		body('login')
			.notEmpty()
			.withMessage('Campo login é obrigatório.')
			.bail()
			.isLength({ max: 255 })
			.withMessage('Campo login deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.authRecoveryLookup.bind(controller)
);

router.post(
	'/usuarios/cadastro-por-convite',
	publicRegistrationKeyGuard,
	[
		body().custom((value, { req }) => {
			const token = req.body?.invite_token ?? req.body?.token;
			if (!token || String(token).trim() === '') {
				throw new Error('Campo invite_token (ou token) é obrigatório.');
			}
			return true;
		}),
		body('nome')
			.notEmpty()
			.withMessage('Campo nome é obrigatório.')
			.bail()
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('password')
			.notEmpty()
			.withMessage('Campo password é obrigatório.')
			.bail()
			.isLength({ min: 6 })
			.withMessage('Campo password deve ter no mínimo 6 caracteres.'),
		body('email')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Campo email inválido.'),
		body('cpf')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cpf = String(value).replace(/\D/g, '');
				if (cpf.length !== 11) {
					throw new Error('CPF deve conter 11 dígitos.');
				}
				return true;
			}),
		body('apartamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo apartamento deve ter no máximo 50 caracteres.'),
		body('bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.'),
		body('path_avatar')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo path_avatar deve ter no máximo 255 caracteres.'),
		body('id_condominio')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_condominio deve ser numérico e maior que zero.'),
		body('condominio_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo condominio_id deve ser numérico e maior que zero.')
	],
	validate,
	controller.cadastrarUsuarioPorConvite.bind(controller)
);

router.post(
	'/usuarios',
	auth,
	[
		body('nome')
			.notEmpty()
			.withMessage('Campo nome é obrigatório.')
			.bail()
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('cpf')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cpf = String(value).replace(/\D/g, '');
				if (cpf.length !== 11) {
					throw new Error('CPF deve conter 11 dígitos.');
				}
				return true;
			}),
		body('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo tipo_morador deve ter no máximo 100 caracteres.'),
		body('password')
			.notEmpty()
			.withMessage('Campo password é obrigatório.')
			.bail()
			.isLength({ min: 6 })
			.withMessage('Campo password deve ter no mínimo 6 caracteres.'),
		body('email')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Campo email inválido.'),
		body('tipo_perfil_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo tipo_perfil_id deve ser numérico e maior que zero.'),
		body('endereco_logradouro')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 200 })
			.withMessage('Campo endereco_logradouro deve ter no máximo 200 caracteres.'),
		body('endereco_numero')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo endereco_numero deve ter no máximo 20 caracteres.'),
		body('endereco_complemento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo endereco_complemento deve ter no máximo 100 caracteres.'),
		body('endereco_bairro')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo endereco_bairro deve ter no máximo 120 caracteres.'),
		body('endereco_cidade')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo endereco_cidade deve ter no máximo 120 caracteres.'),
		body('endereco_uf')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ min: 2, max: 2 })
			.withMessage('Campo endereco_uf deve ter 2 caracteres.'),
		body('endereco_cep')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 8 })
			.withMessage('Campo endereco_cep deve ter no máximo 8 caracteres.'),
		body('apartamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo apartamento deve ter no máximo 50 caracteres.'),
		body('bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.'),
		body('path_avatar')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo path_avatar deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.criarUsuario.bind(controller)
);

router.put(
	'/usuarios/:id(\\d+)',
	authOrInviteToken,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('nome')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('cpf')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cpf = String(value).replace(/\D/g, '');
				if (cpf.length !== 11) {
					throw new Error('CPF deve conter 11 dígitos.');
				}
				return true;
			}),
		body('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo tipo_morador deve ter no máximo 100 caracteres.'),
		body('password')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ min: 6 })
			.withMessage('Campo password deve ter no mínimo 6 caracteres.'),
		body('email')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Campo email inválido.'),
		body('tipo_perfil_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo tipo_perfil_id deve ser numérico e maior que zero.'),
		body('endereco_logradouro')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 200 })
			.withMessage('Campo endereco_logradouro deve ter no máximo 200 caracteres.'),
		body('endereco_numero')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo endereco_numero deve ter no máximo 20 caracteres.'),
		body('endereco_complemento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo endereco_complemento deve ter no máximo 100 caracteres.'),
		body('endereco_bairro')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo endereco_bairro deve ter no máximo 120 caracteres.'),
		body('endereco_cidade')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo endereco_cidade deve ter no máximo 120 caracteres.'),
		body('endereco_uf')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ min: 2, max: 2 })
			.withMessage('Campo endereco_uf deve ter 2 caracteres.'),
		body('endereco_cep')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 8 })
			.withMessage('Campo endereco_cep deve ter no máximo 8 caracteres.'),
		body('apartamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo apartamento deve ter no máximo 50 caracteres.'),
		body('bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.'),
		body('path_avatar')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo path_avatar deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.editarUsuario.bind(controller)
);

router.patch(
	'/usuarios/:id(\\d+)',
	authOrInviteToken,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('nome')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('cpf')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const cpf = String(value).replace(/\D/g, '');
				if (cpf.length !== 11) {
					throw new Error('CPF deve conter 11 dígitos.');
				}
				return true;
			}),
		body('tipo_morador')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo tipo_morador deve ter no máximo 100 caracteres.'),
		body('password')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ min: 6 })
			.withMessage('Campo password deve ter no mínimo 6 caracteres.'),
		body('email')
			.optional({ nullable: true, checkFalsy: true })
			.isEmail()
			.withMessage('Campo email inválido.'),
		body('tipo_perfil_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo tipo_perfil_id deve ser numérico e maior que zero.'),
		body('endereco_logradouro')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 200 })
			.withMessage('Campo endereco_logradouro deve ter no máximo 200 caracteres.'),
		body('endereco_numero')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo endereco_numero deve ter no máximo 20 caracteres.'),
		body('endereco_complemento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo endereco_complemento deve ter no máximo 100 caracteres.'),
		body('endereco_bairro')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo endereco_bairro deve ter no máximo 120 caracteres.'),
		body('endereco_cidade')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 120 })
			.withMessage('Campo endereco_cidade deve ter no máximo 120 caracteres.'),
		body('endereco_uf')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ min: 2, max: 2 })
			.withMessage('Campo endereco_uf deve ter 2 caracteres.'),
		body('endereco_cep')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 8 })
			.withMessage('Campo endereco_cep deve ter no máximo 8 caracteres.'),
		body('apartamento')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo apartamento deve ter no máximo 50 caracteres.'),
		body('bloco')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 50 })
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.'),
		body('path_avatar')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 255 })
			.withMessage('Campo path_avatar deve ter no máximo 255 caracteres.')
	],
	validate,
	controller.editarUsuario.bind(controller)
);

router.post(
	'/espacos',
	auth,
	[
		body('nome')
			.notEmpty()
			.withMessage('Campo nome é obrigatório.')
			.bail()
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('capacidade')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo capacidade deve ser numérico.'),
		body('antecedencia_min_horas')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Campo antecedencia_min_horas deve ser numérico.'),
		body('periodo_manha')
			.optional({ nullable: true })
			.isInt({ min: 0 })
			.withMessage('Campo periodo_manha deve ser numérico.'),
		body('periodo_tarde')
			.optional({ nullable: true })
			.isInt({ min: 0 })
			.withMessage('Campo periodo_tarde deve ser numérico.'),
		body('periodo_noite')
			.optional({ nullable: true })
			.isInt({ min: 0 })
			.withMessage('Campo periodo_noite deve ser numérico.'),
		body('segunda')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo segunda deve ser 0 ou 1.'),
		body('terca')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo terca deve ser 0 ou 1.'),
		body('quarta')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo quarta deve ser 0 ou 1.'),
		body('quinta')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo quinta deve ser 0 ou 1.'),
		body('sexta')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo sexta deve ser 0 ou 1.'),
		body('sabado')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo sabado deve ser 0 ou 1.'),
		body('domingo')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo domingo deve ser 0 ou 1.'),
		body('periodo_modo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo periodo_modo deve ter no máximo 100 caracteres.'),
		body('taxa_reserva')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat({ min: 0 })
			.withMessage('Campo taxa_reserva deve ser numérico.')
	],
	validate,
	controller.criarEspaco.bind(controller)
);

router.put(
	'/espacos/:id(\\d+)',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('nome')
			.notEmpty()
			.withMessage('Campo nome é obrigatório.')
			.bail()
			.isLength({ max: 120 })
			.withMessage('Campo nome deve ter no máximo 120 caracteres.'),
		body('capacidade')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo capacidade deve ser numérico.'),
		body('antecedencia_min_horas')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 0 })
			.withMessage('Campo antecedencia_min_horas deve ser numérico.'),
		body('periodo_manha')
			.optional({ nullable: true })
			.isInt({ min: 0 })
			.withMessage('Campo periodo_manha deve ser numérico.'),
		body('periodo_tarde')
			.optional({ nullable: true })
			.isInt({ min: 0 })
			.withMessage('Campo periodo_tarde deve ser numérico.'),
		body('periodo_noite')
			.optional({ nullable: true })
			.isInt({ min: 0 })
			.withMessage('Campo periodo_noite deve ser numérico.'),
		body('segunda')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo segunda deve ser 0 ou 1.'),
		body('terca')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo terca deve ser 0 ou 1.'),
		body('quarta')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo quarta deve ser 0 ou 1.'),
		body('quinta')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo quinta deve ser 0 ou 1.'),
		body('sexta')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo sexta deve ser 0 ou 1.'),
		body('sabado')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo sabado deve ser 0 ou 1.'),
		body('domingo')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo domingo deve ser 0 ou 1.'),
		body('periodo_modo')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo periodo_modo deve ter no máximo 100 caracteres.'),
		body('taxa_reserva')
			.optional({ nullable: true, checkFalsy: true })
			.isFloat({ min: 0 })
			.withMessage('Campo taxa_reserva deve ser numérico.')
	],
	validate,
	controller.editarEspaco.bind(controller)
);

router.get(
	'/espacos/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarEspacoPorId.bind(controller)
);

router.get(
	'/espacos',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('orderBy')
			.optional({ nullable: true, checkFalsy: true })
			.isIn(['id', 'nome'])
			.withMessage('Parâmetro orderBy deve ser id ou nome.'),
		query('ativo')
			.optional({ nullable: true, checkFalsy: true })
			.isBoolean()
			.withMessage('Parâmetro ativo deve ser booleano.')
			.toBoolean()
	],
	validate,
	controller.listarEspacosPaginado.bind(controller)
);

router.get(
	'/espacos/agenda',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('id_espaco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_espaco deve ser numérico e maior que zero.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('aba')
			.optional({ nullable: true, checkFalsy: true })
			.isIn(['em_andamento', 'concluidos'])
			.withMessage('Parâmetro aba deve ser em_andamento ou concluidos.'),
		query('data_agendamento')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const valor = String(value || '').trim();

				if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
					const [dia, mes, ano] = valor.split('/').map((item) => Number(item));
					const data = new Date(Date.UTC(ano, mes - 1, dia));
					if (
						data.getUTCFullYear() === ano &&
						data.getUTCMonth() === mes - 1 &&
						data.getUTCDate() === dia
					) {
						return true;
					}
				}

				if (!Number.isNaN(Date.parse(valor))) {
					return true;
				}

				throw new Error('Parâmetro data_agendamento deve ser uma data válida (ISO 8601 ou dd/mm/aaaa).');
			}),
		query('data_inicio')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const valor = String(value || '').trim();

				if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
					const [dia, mes, ano] = valor.split('/').map((item) => Number(item));
					const data = new Date(Date.UTC(ano, mes - 1, dia));
					if (
						data.getUTCFullYear() === ano &&
						data.getUTCMonth() === mes - 1 &&
						data.getUTCDate() === dia
					) {
						return true;
					}
				}

				if (!Number.isNaN(Date.parse(valor))) {
					return true;
				}

				throw new Error('Parâmetro data_inicio deve ser uma data válida (ISO 8601 ou dd/mm/aaaa).');
			}),
		query('data_fim')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const valor = String(value || '').trim();

				if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
					const [dia, mes, ano] = valor.split('/').map((item) => Number(item));
					const data = new Date(Date.UTC(ano, mes - 1, dia));
					if (
						data.getUTCFullYear() === ano &&
						data.getUTCMonth() === mes - 1 &&
						data.getUTCDate() === dia
					) {
						return true;
					}
				}

				if (!Number.isNaN(Date.parse(valor))) {
					return true;
				}

				throw new Error('Parâmetro data_fim deve ser uma data válida (ISO 8601 ou dd/mm/aaaa).');
			})
	],
	validate,
	controller.listarSalasReservadas.bind(controller)
);

router.get(
	'/espacos/agenda/minhas',
	auth,
	[
		query('page')
			.optional()
			.isInt({ min: 1 })
			.withMessage('Parâmetro page deve ser numérico e maior que zero.'),
		query('pageSize')
			.optional()
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
		query('id_espaco')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Parâmetro id_espaco deve ser numérico e maior que zero.'),
		query('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Parâmetro status deve ter no máximo 20 caracteres.'),
		query('aba')
			.optional({ nullable: true, checkFalsy: true })
			.isIn(['em_andamento', 'concluidos'])
			.withMessage('Parâmetro aba deve ser em_andamento ou concluidos.'),
		query('data_agendamento')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const valor = String(value || '').trim();

				if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
					const [dia, mes, ano] = valor.split('/').map((item) => Number(item));
					const data = new Date(Date.UTC(ano, mes - 1, dia));
					if (
						data.getUTCFullYear() === ano &&
						data.getUTCMonth() === mes - 1 &&
						data.getUTCDate() === dia
					) {
						return true;
					}
				}

				if (!Number.isNaN(Date.parse(valor))) {
					return true;
				}

				throw new Error('Parâmetro data_agendamento deve ser uma data válida (ISO 8601 ou dd/mm/aaaa).');
			})
	],
	validate,
	controller.listarMinhasReservas.bind(controller)
);

router.get(
	'/espacos/agenda/mes-corrente',
	auth,
	controller.listarReservasMesCorrente.bind(controller)
);

router.post(
	'/espacos/:id(\\d+)/agenda',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 20 })
			.withMessage('Campo status deve ter no máximo 20 caracteres.'),
		body('observacoes')
			.optional({ nullable: true })
			.isLength({ max: 2000 })
			.withMessage('Campo observacoes deve ter no máximo 2000 caracteres.'),
		body('usuario_id')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo usuario_id deve ser numérico e maior que zero.'),
		body('periodo_manha')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo periodo_manha deve ser 0 ou 1.'),
		body('periodo_tarde')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo periodo_tarde deve ser 0 ou 1.'),
		body('periodo_noite')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo periodo_noite deve ser 0 ou 1.'),
		body('modo_sala')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 100 })
			.withMessage('Campo modo_sala deve ter no máximo 100 caracteres.'),
		body('data_agendamento')
			.optional({ nullable: true, checkFalsy: true })
			.custom((value) => {
				const valor = String(value || '').trim();

				if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
					const [dia, mes, ano] = valor.split('/').map((item) => Number(item));
					const data = new Date(Date.UTC(ano, mes - 1, dia));
					if (
						data.getUTCFullYear() === ano &&
						data.getUTCMonth() === mes - 1 &&
						data.getUTCDate() === dia
					) {
						return true;
					}
				}

				if (!Number.isNaN(Date.parse(valor))) {
					return true;
				}

				throw new Error('Campo data_agendamento deve ser uma data válida (ISO 8601 ou dd/mm/aaaa).');
			})
	],
	validate,
	controller.agendarEspaco.bind(controller)
);

router.get(
	'/espacos/agenda/:id(\\d+)/tratamento/logs',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.listarLogsTratamentoAgenda.bind(controller)
);

router.get(
	'/notificacoes/usuario/:id_usuario(\\d+)',
	auth,
	[param('id_usuario').isInt({ min: 1 }).withMessage('Parâmetro id_usuario inválido.')],
	validate,
	controller.listarNotificacoesUsuario.bind(controller)
);

router.patch(
	'/notificacoes/:id(\\d+)/lida',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.marcarNotificacaoComoLida.bind(controller)
);

router.patch(
	'/espacos/agenda/:id(\\d+)/tratamento',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 80 })
			.withMessage('Campo status deve ter no máximo 80 caracteres.'),
		body('status_code')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo status_code deve ser numérico e maior que zero.'),
		body('observacoes')
			.optional({ nullable: true })
			.isLength({ max: 1250 })
			.withMessage('Campo observacoes deve ter no máximo 1250 caracteres.'),
		body('motivo_pendencia')
			.optional({ nullable: true })
			.isLength({ max: 250 })
			.withMessage('Campo motivo_pendencia deve ter no máximo 250 caracteres.'),
		body('taxa_paga_flag')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo taxa_paga_flag deve ser 0 ou 1.'),
		body('taxa_paga')
			.optional({ nullable: true })
			.custom((value) => {
				if (
					typeof value === 'boolean' ||
					value === 0 ||
					value === 1 ||
					value === '0' ||
					value === '1' ||
					value === 'true' ||
					value === 'false'
				) {
					return true;
				}

				throw new Error('Campo taxa_paga deve ser boolean, 0/1 ou true/false.');
			}),
		body('id_usuario_tratamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_usuario_tratamento deve ser numérico e maior que zero.')
	],
	validate,
	controller.atualizarTratamentoAgenda.bind(controller)
);

router.put(
	'/espacos/agenda/:id(\\d+)/tratamento',
	auth,
	[
		param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.'),
		body('status')
			.optional({ nullable: true, checkFalsy: true })
			.isLength({ max: 80 })
			.withMessage('Campo status deve ter no máximo 80 caracteres.'),
		body('status_code')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo status_code deve ser numérico e maior que zero.'),
		body('observacoes')
			.optional({ nullable: true })
			.isLength({ max: 1250 })
			.withMessage('Campo observacoes deve ter no máximo 1250 caracteres.'),
		body('motivo_pendencia')
			.optional({ nullable: true })
			.isLength({ max: 250 })
			.withMessage('Campo motivo_pendencia deve ter no máximo 250 caracteres.'),
		body('taxa_paga_flag')
			.optional({ nullable: true })
			.isInt({ min: 0, max: 1 })
			.withMessage('Campo taxa_paga_flag deve ser 0 ou 1.'),
		body('taxa_paga')
			.optional({ nullable: true })
			.custom((value) => {
				if (
					typeof value === 'boolean' ||
					value === 0 ||
					value === 1 ||
					value === '0' ||
					value === '1' ||
					value === 'true' ||
					value === 'false'
				) {
					return true;
				}

				throw new Error('Campo taxa_paga deve ser boolean, 0/1 ou true/false.');
			}),
		body('id_usuario_tratamento')
			.optional({ nullable: true, checkFalsy: true })
			.isInt({ min: 1 })
			.withMessage('Campo id_usuario_tratamento deve ser numérico e maior que zero.')
	],
	validate,
	controller.atualizarTratamentoAgenda.bind(controller)
);

router.delete(
	'/espacos/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.excluirEspaco.bind(controller)
);

module.exports = router;