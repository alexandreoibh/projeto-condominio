"use strict";

const express = require("express");
const router = express.Router();
const { body, param, query } = require("express-validator");
const ReuniaoController = require("../controllers/reuniaoController");
const auth = require("../helpers/auth");
const validate = require("../helpers/validate");

const controller = new ReuniaoController();

// GET /api/reuniao — lista reunioes com filtros opcionais
router.get(
  "/",
  auth,
  [
    query("status")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["CRIADA", "CONVOCADA", "EM_ANDAMENTO", "FINALIZADA", "CANCELADA"])
      .withMessage("status deve ser: CRIADA, CONVOCADA, EM_ANDAMENTO, FINALIZADA ou CANCELADA."),
    query("tipo")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["ordinaria", "extraordinaria"])
      .withMessage("tipo deve ser: ordinaria ou extraordinaria."),
    query("data_inicio")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("data_inicio invalida."),
    query("data_fim")
      .optional({ nullable: true, checkFalsy: true })
      .isString()
      .withMessage("data_fim invalida."),
    query("page")
      .optional({ nullable: true, checkFalsy: true })
      .isInt({ min: 1 })
      .withMessage("page deve ser inteiro maior que zero."),
    query("pageSize")
      .optional({ nullable: true, checkFalsy: true })
      .isInt({ min: 1, max: 100 })
      .withMessage("pageSize deve ser entre 1 e 100.")
  ],
  validate,
  controller.listar.bind(controller)
);

// GET /api/reuniao/pendente-confirmacao — reuniao em aberto pendente de confirmacao do usuario logado
router.get(
  "/pendente-confirmacao",
  auth,
  controller.pendenteConfirmacao.bind(controller)
);

// GET /api/reuniao/:id — busca reuniao por id com lista de presencas
router.get(
  "/:id(\\d+)",
  auth,
  [param("id").isInt({ min: 1 }).withMessage("Parametro id invalido.")],
  validate,
  controller.buscarPorId.bind(controller)
);

// POST /api/reuniao — cria nova reuniao
router.post(
  "/",
  auth,
  [
    body("titulo")
      .notEmpty()
      .withMessage("Campo titulo e obrigatorio.")
      .bail()
      .isLength({ max: 255 })
      .withMessage("titulo deve ter no maximo 255 caracteres."),
    body("data_hora")
      .notEmpty()
      .withMessage("Campo data_hora e obrigatorio."),
    body("tipo")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["ordinaria", "extraordinaria"])
      .withMessage("tipo deve ser: ordinaria ou extraordinaria."),
    body("local")
      .optional({ nullable: true, checkFalsy: true })
      .isLength({ max: 255 })
      .withMessage("local deve ter no maximo 255 caracteres."),
    body("link_online")
      .optional({ nullable: true, checkFalsy: true })
      .isURL()
      .withMessage("link_online deve ser uma URL valida.")
      .isLength({ max: 500 })
      .withMessage("link_online deve ter no maximo 500 caracteres."),
    body("data_limite_confirmacao")
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage("data_limite_confirmacao deve ser data ISO 8601 valida."),
    body("notificar_moradores")
      .optional({ nullable: true })
      .isBoolean()
      .withMessage("notificar_moradores deve ser booleano."),
    body("enviar_email")
      .optional({ nullable: true })
      .isIn([0, 1, "0", "1", true, false])
      .withMessage("enviar_email deve ser 0 ou 1."),
    body("filtro_destinatario")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["todos", "inquilinos", "proprietarios"])
      .withMessage("filtro_destinatario deve ser: todos, inquilinos ou proprietarios.")
  ],
  validate,
  controller.criar.bind(controller)
);

// PUT /api/reuniao/:id — atualiza todos os campos da reuniao
router.put(
  "/:id(\\d+)",
  auth,
  [
    param("id").isInt({ min: 1 }).withMessage("Parametro id invalido."),
    body("titulo")
      .notEmpty()
      .withMessage("Campo titulo e obrigatorio.")
      .bail()
      .isLength({ max: 255 })
      .withMessage("titulo deve ter no maximo 255 caracteres."),
    body("data_hora")
      .notEmpty()
      .withMessage("Campo data_hora e obrigatorio."),
    body("tipo")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["ordinaria", "extraordinaria"])
      .withMessage("tipo deve ser: ordinaria ou extraordinaria."),
    body("status")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["CRIADA", "CONVOCADA", "EM_ANDAMENTO", "FINALIZADA", "CANCELADA"])
      .withMessage("status deve ser: CRIADA, CONVOCADA, EM_ANDAMENTO, FINALIZADA ou CANCELADA.")
  ],
  validate,
  controller.atualizar.bind(controller)
);

// PATCH /api/reuniao/:id — atualiza campos parcialmente
router.patch(
  "/:id(\\d+)",
  auth,
  [
    param("id").isInt({ min: 1 }).withMessage("Parametro id invalido."),
    body().custom((value, { req }) => {
      const camposPermitidos = ["titulo", "descricao", "tipo", "data_hora", "local", "link_online", "pauta", "ata", "status"];
      if (!camposPermitidos.some((c) => req.body[c] !== undefined)) {
        throw new Error(`Informe ao menos um campo para atualizacao: ${camposPermitidos.join(", ")}.`);
      }
      return true;
    }),
    body("tipo")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["ordinaria", "extraordinaria"])
      .withMessage("tipo deve ser: ordinaria ou extraordinaria."),
    body("status")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["CRIADA", "CONVOCADA", "EM_ANDAMENTO", "FINALIZADA", "CANCELADA"])
      .withMessage("status deve ser: CRIADA, CONVOCADA, EM_ANDAMENTO, FINALIZADA ou CANCELADA.")
  ],
  validate,
  controller.atualizarParcial.bind(controller)
);

// DELETE /api/reuniao/:id — cancela reuniao (soft delete via status)
router.delete(
  "/:id(\\d+)",
  auth,
  [param("id").isInt({ min: 1 }).withMessage("Parametro id invalido.")],
  validate,
  controller.cancelar.bind(controller)
);

// POST /api/reuniao/:id/presenca — confirma/recusa presenca do usuario autenticado
router.post(
  "/:id(\\d+)/presenca",
  auth,
  [
    param("id").isInt({ min: 1 }).withMessage("Parametro id invalido."),
    body("presente")
      .optional({ nullable: true })
      .isBoolean()
      .withMessage("presente deve ser booleano (true ou false)."),
    body("status")
      .optional({ nullable: true, checkFalsy: true })
      .isIn(["CONFIRMADO", "RECUSADO"])
      .withMessage("status deve ser: CONFIRMADO ou RECUSADO."),
    body("data_checkin")
      .optional({ nullable: true, checkFalsy: true })
      .isISO8601()
      .withMessage("data_checkin deve ser uma data ISO 8601 valida.")
  ],
  validate,
  controller.confirmarPresenca.bind(controller)
);

// GET /api/reuniao/:id/presencas — lista todos os presencas de uma reuniao
router.get(
  "/:id(\\d+)/presencas",
  auth,
  [param("id").isInt({ min: 1 }).withMessage("Parametro id invalido.")],
  validate,
  controller.listarPresencas.bind(controller)
);

module.exports = router;


