const express = require('express');
const router = express.Router();
const LoginController = require('../controllers/loginController');

const login = new LoginController();

// ******************Gestor********************************************* 
router.post('/', login.login.bind(login));
router.get('/', login.index.bind(login));

module.exports = router;
// ******************Gestor fim********************************************* 
