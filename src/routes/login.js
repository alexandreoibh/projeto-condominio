const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const LoginController = require('../controllers/loginController');
const validate = require('../helpers/validate');

const login = new LoginController();


router.post(
    '/',
    [
        body('login')
            .notEmpty()
            .withMessage('Campo login é obrigatório.')
            .bail()
            .custom((value) => {
                const loginValue = String(value).trim();
                const cpf = loginValue.replace(/\D/g, '');
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

                if (cpf.length === 11 || emailRegex.test(loginValue.toLowerCase())) {
                    return true;
                }

                throw new Error('Login deve ser um CPF válido (11 dígitos) ou e-mail válido.');
            }),
        body('password')
            .notEmpty()
            .withMessage('Campo password é obrigatório.')
    ],
    validate,
    login.login.bind(login)
);

module.exports = router;

