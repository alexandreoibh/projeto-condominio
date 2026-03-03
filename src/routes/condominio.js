const express = require('express');
const router = express.Router();
const CondominioController = require('../controllers/condominioController');
const auth = require('../helpers/auth');

const controller = new CondominioController();

router.get('/status', controller.status.bind(controller));
router.get('/moradores', auth, controller.listarMoradores.bind(controller));

module.exports = router;