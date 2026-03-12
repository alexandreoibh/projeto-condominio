const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const CondominioController = require('../controllers/condominioController');
const auth = require('../helpers/auth');
const validate = require('../helpers/validate');

const controller = new CondominioController();

router.get('/status', controller.status.bind(controller));
router.get('/menu', auth, controller.listarMenuDinamico.bind(controller));
router.get('/dashboard/tipos', auth, controller.listarDashboardTipos.bind(controller));
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
			.isInt({ min: 1, max: 100 })
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.'),
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
			.withMessage('Campo exibicao_dashboard deve ser 0 ou 1.')
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
			.withMessage('Campo exibicao_dashboard deve ser 0 ou 1.')
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
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.')
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
			.withMessage('Parâmetro pageSize deve estar entre 1 e 100.')
	],
	validate,
	controller.listarMoradores.bind(controller)
);

router.get(
	'/usuarios/:id(\\d+)',
	auth,
	[param('id').isInt({ min: 1 }).withMessage('Parâmetro id inválido.')],
	validate,
	controller.buscarUsuarioPorId.bind(controller)
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
			.notEmpty()
			.withMessage('Campo cpf é obrigatório.')
			.bail()
			.custom((value) => {
				const cpf = String(value).replace(/\D/g, '');
				if (cpf.length !== 11) {
					throw new Error('CPF deve conter 11 dígitos.');
				}
				return true;
			}),
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
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.')
	],
	validate,
	controller.criarUsuario.bind(controller)
);

router.put(
	'/usuarios/:id(\\d+)',
	auth,
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
			.withMessage('Campo bloco deve ter no máximo 50 caracteres.')
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