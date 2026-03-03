const express = require('express');
const router = express.Router();
const UserSystemController = require('../controllers/userSystemController');
const { body } = require('express-validator');
const validate = require('../helpers/validate');
const auth = require('../helpers/auth');

const userSys = new UserSystemController();

router.get('/', auth, userSys.getUsers.bind(userSys));
router.get('/excelPlataforma', auth, userSys.getUsersExcelPlataforma.bind(userSys));   
router.get('/userListAssessor', auth, userSys.getAssessor.bind(userSys));
router.get('/userBankSystem', auth, userSys.getUsersBank.bind(userSys));
router.get('/userCotitular', auth, userSys.getUsersCotitular.bind(userSys));
router.get('/allBanks', auth, userSys.getAllBanks.bind(userSys));
router.get('/userAssessores', auth,  userSys.getAssessores.bind(userSys));
router.get('/userClienteAssessores', auth, userSys.getClienteAssessores.bind(userSys));
router.get('/assessores', auth, userSys.getAssessoresAgente.bind(userSys));
router.get('/listGestoraFundos', auth, userSys.getListGestoraFundos.bind(userSys));
router.get('/listAdministradoraFundos', auth, userSys.getListAdministradoraFundos.bind(userSys)); 
router.get('/listPerfilFundos', auth, userSys.getListPerfilFundos.bind(userSys)); 
router.get('/userMovimentacoes', auth, userSys.getUserMovimentacoes.bind(userSys));
router.get('/fundosProdutos', auth, userSys.getFundosProdutos.bind(userSys));
router.get('/fundosProdutosCvm', auth, userSys.getFundosProdutosCvm.bind(userSys));
router.get('/fundosProdutosCvmCnpj', auth, userSys.getFundosProdutosCvmCnpj.bind(userSys));
router.get('/fundosExtratoCvmCnpj', auth, userSys.getFundosExtratoCvmCnpj.bind(userSys));
router.get('/fundosProdutoItem', auth, userSys.getFundosProdutoItem.bind(userSys));
router.get('/fundosListFundos', auth, userSys.getListaFundosProdutos.bind(userSys));
router.get('/timePhilos', auth, userSys.getListaTimePhilos.bind(userSys));
router.get('/movimentacoes', auth, userSys.getMovimentacoes.bind(userSys));
router.get('/movimentacoesCientes', auth, userSys.getMovimentacoesClientes.bind(userSys));
router.get('/movimentacoesNomeGestor', auth, userSys.getMovimentacoesNomeGestor.bind(userSys));
router.get('/gestoras', auth, userSys.getGestoras.bind(userSys));
router.get('/listCotas', auth, userSys.getCotas.bind(userSys));
router.get('/listTipoStatusInvestimento', auth, userSys.getTipoStatusInvestimento.bind(userSys));
router.get('/listTipoEstrategias', auth, userSys.getTipoEstrategias.bind(userSys));
router.get('/listTipoPerfil', auth, userSys.getTipoPerfil.bind(userSys));
router.get('/listPublicoAlvo', auth, userSys.getPublicoAlvo.bind(userSys));
router.get('/listBenchmark', auth, userSys.getBenchmark.bind(userSys));
router.get('/listPeriodosPfees', auth, userSys.getPeriodosPfees.bind(userSys));
router.get('/listTipoDias', auth, userSys.getTipoDias.bind(userSys));
router.get('/listAdministradorFundo', auth, userSys.getAdministradorFundo.bind(userSys));
router.get('/exportExcel', auth, userSys.getExportExcel.bind(userSys));
router.get('/userSaldoFundo', auth, userSys.getUserSaldoFundo.bind(userSys));
router.get('/movimentacoesRel', auth, userSys.getMovimentacoesRel.bind(userSys));
router.get('/orgaosEmissores', auth, userSys.getOrgaosEmissores.bind(userSys));
router.get('/coTitulares', auth, userSys.getCoTitulares.bind(userSys));    
router.get('/getCep', auth,  userSys.getCep.bind(userSys));
router.get('/existeApelido', auth,  userSys.getExisteApelido.bind(userSys));   
router.get('/existeCpfCnpj', auth,  userSys.getExisteCpfCnpj.bind(userSys)); 
router.get('/existeCpfCotitular', auth,  userSys.getExisteCpfCotitular.bind(userSys)); 
router.get('/existeCodBrain', auth,  userSys.getExisteCodBrain.bind(userSys)); 
 


router.post('/bancosTemp', auth, userSys.postBancosTemp.bind(userSys));
router.post('/storeMovimentacoes', auth, userSys.postStoreMovimentacoes.bind(userSys));
router.post('/emailMovimentacoes', auth, userSys.enviarEmailMovimentacoes.bind(userSys));
router.post('/postDadosBancoUser', auth, userSys.postDadosBancoUser.bind(userSys));
router.post('/salvarFundo', auth, userSys.postSalvarFundo.bind(userSys));
router.post('/tratamentoUserPhilos', auth, userSys.postSetTratamentouserPhilos.bind(userSys));


router.put('/movimentacoes', auth, userSys.putMovimentacoes.bind(userSys));
router.put('/statusUser', auth, userSys.putSetStatusUser.bind(userSys));
router.put('/putDadosPessoaisUser', auth, userSys.putDadosPessoaisUser.bind(userSys));
router.put('/putEnderecoResidencialUser', auth, userSys.putEnderecoResidencialUser.bind(userSys));
router.put('/putDadosBancoUser', auth, userSys.putDadosBancoUser.bind(userSys));
router.put('/putAssessorUser', auth, userSys.putAssessorUser.bind(userSys));
router.put('/statusAssessor', auth, userSys.putSetStatusAssessor.bind(userSys));
router.put('/statusUserPhilos', auth, userSys.putSetStatusUserPhilos.bind(userSys));
router.put('/tratamentoUserPhilos', auth, userSys.putSetTratamentouserPhilos.bind(userSys));


module.exports = router;

