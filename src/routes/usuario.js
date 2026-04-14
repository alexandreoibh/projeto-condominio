const express = require('express');
const { body } = require('express-validator');

const auth = require('../helpers/auth');
const validate = require('../helpers/validate');
const UsuarioController = require('../controllers/usuarioController');

const router = express.Router();
const controller = new UsuarioController();

router.post(
  '/push-token',
  auth,
  [
    body('token')
      .notEmpty()
      .withMessage('Campo token é obrigatório.')
      .bail()
      .isString()
      .withMessage('Campo token deve ser string.')
      .bail()
      .isLength({ max: 300 })
      .withMessage('Campo token deve ter no máximo 300 caracteres.'),
    body('plataforma')
      .notEmpty()
      .withMessage('Campo plataforma é obrigatório.')
      .bail()
      .isString()
      .withMessage('Campo plataforma deve ser string.')
      .bail()
      .customSanitizer((value) => String(value).trim().toLowerCase())
      .isIn(['android', 'ios'])
      .withMessage('Campo plataforma deve ser android ou ios.')
  ],
  validate,
  controller.salvarPushToken.bind(controller)
);

router.post(
  '/push/teste',
  auth,
  [
    body().custom((value, { req }) => {
      const temToken = req.body?.to !== undefined && String(req.body.to).trim() !== '';
      const idUsuario = Number.parseInt(req.body?.id_usuario, 10);
      const temUsuario = Number.isInteger(idUsuario) && idUsuario > 0;

      if (!temToken && !temUsuario) {
        throw new Error('Informe to (push token) ou id_usuario.');
      }

      return true;
    }),
    body('to')
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage('Campo to deve ser string.'),
    body('id_usuario')
      .optional({ nullable: true, checkFalsy: true })
      .isInt({ min: 1 })
      .withMessage('Campo id_usuario deve ser numérico e maior que zero.'),
    body('title')
      .notEmpty()
      .withMessage('Campo title é obrigatório.'),
    body('body')
      .notEmpty()
      .withMessage('Campo body é obrigatório.'),
    body('sound')
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage('Campo sound deve ser string.'),
    body('data')
      .optional({ nullable: true })
      .isObject()
      .withMessage('Campo data deve ser objeto JSON.')
  ],
  validate,
  controller.enviarPushTeste.bind(controller)
);

router.post(
  '/push/teste/massa',
  auth,
  [
    body().custom((value, { req }) => {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const ids = Array.isArray(req.body?.id_usuarios) ? req.body.id_usuarios : [];

      if (messages.length === 0 && ids.length === 0) {
        throw new Error('Informe messages[] ou id_usuarios[].');
      }

      return true;
    }),
    body('messages')
      .optional({ nullable: true })
      .isArray({ min: 1 })
      .withMessage('Campo messages deve ser um array com ao menos 1 item.'),
    body('messages.*.to')
      .optional({ nullable: true })
      .isString()
      .withMessage('Campo messages[].to deve ser string.'),
    body('messages.*.title')
      .optional({ nullable: true })
      .isString()
      .withMessage('Campo messages[].title deve ser string.'),
    body('messages.*.body')
      .optional({ nullable: true })
      .isString()
      .withMessage('Campo messages[].body deve ser string.'),
    body('messages.*.sound')
      .optional({ nullable: true })
      .isString()
      .withMessage('Campo messages[].sound deve ser string.'),
    body('messages.*.data')
      .optional({ nullable: true })
      .isObject()
      .withMessage('Campo messages[].data deve ser objeto JSON.'),
    body('id_usuarios')
      .optional({ nullable: true })
      .isArray({ min: 1 })
      .withMessage('Campo id_usuarios deve ser um array com ao menos 1 item.'),
    body('id_usuarios.*')
      .optional({ nullable: true })
      .isInt({ min: 1 })
      .withMessage('Campo id_usuarios[] deve ser numérico e maior que zero.'),
    body('title')
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage('Campo title deve ser string.'),
    body('body')
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage('Campo body deve ser string.'),
    body('sound')
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage('Campo sound deve ser string.'),
    body('data')
      .optional({ nullable: true })
      .isObject()
      .withMessage('Campo data deve ser objeto JSON.')
  ],
  validate,
  controller.enviarPushTesteMassa.bind(controller)
);

module.exports = router;
