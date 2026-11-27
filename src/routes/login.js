const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { errosValidacaoSemValor } = require('../helpers/entradaSegura');
const LoginController = require('../controllers/loginController');
const validate = require('../helpers/validate');
const auth = require('../helpers/auth');

const login = new LoginController();


// Auditoria 27/11/2026: só e-mail ou CPF nos formatos legítimos; tipo, controle
// e tamanho checados ANTES da consulta de autenticação. A falha de validação
// conta no rate limit e é auditada com fingerprint (nunca o valor).
const EMAIL_LOGIN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;
const CPF_LOGIN = /^(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/;
const CONTROLE = /[\u0000-\u001F\u007F]/;

const validarLogin = async (req, res, next) => {
    const erros = validationResult(req);
    if (erros.isEmpty()) return next();
    try {
        const limite = await login.registrarEntradaInvalida(req);
        if (limite.bloqueado && !limite.erro) {
            return res.status(429).send({ check: false, message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' });
        }
    } catch (erro) {
        console.error('[login] Falha ao registrar entrada inválida:', erro?.message);
    }
    return res.status(422).json({ errors: errosValidacaoSemValor(erros.array()) });
};

router.post(
    '/',
    [
        body('login')
            .custom((value) => {
                if (typeof value !== 'string') throw new Error('Campo login deve ser texto.');
                const loginValue = value.trim();
                if (!loginValue) throw new Error('Campo login é obrigatório.');
                if (loginValue.length > 254 || CONTROLE.test(loginValue)) throw new Error('Login inválido.');
                if (EMAIL_LOGIN.test(loginValue) || CPF_LOGIN.test(loginValue)) return true;
                throw new Error('Login deve ser um CPF válido (11 dígitos) ou e-mail válido.');
            }),
        body('password')
            .custom((value) => {
                if (typeof value !== 'string' || value.length === 0) throw new Error('Campo password é obrigatório.');
                if (value.length > 1024) throw new Error('Campo password excede o tamanho máximo.');
                return true;
            })
    ],
    validarLogin,
    login.login.bind(login)
);

router.post(
    '/logout',
    auth,
    login.logout.bind(login)
);

module.exports = router;

