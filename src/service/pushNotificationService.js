"use strict";

const { Expo } = require("expo-server-sdk");
const { QueryTypes } = require("sequelize");
const postgres = require("../database/postgres");

const expo = new Expo();
const MAX_MESSAGES_PER_REQUEST = 100;
const TIPOS_EVENTO_APP = new Set([
  "encomenda",
  "reuniao",
  "aviso",
  "ocorrencia",
  "financeiro",
  "visitante"
]);

class PushNotificationService {
  _normalizarData(data = {}) {
    const payload = data && typeof data === "object" ? { ...data } : {};
    const tipo = String(payload.tipo || "").trim().toLowerCase();

    if (tipo && !TIPOS_EVENTO_APP.has(tipo)) {
      throw new Error(`Tipo de push inválido: ${tipo}`);
    }

    if (tipo) {
      payload.tipo = tipo;
    }

    return payload;
  }

  _normalizarMensagem(message = {}) {
    return {
      to: message.to,
      sound: message.sound || "default",
      title: message.title || "",
      body: message.body || "",
      data: this._normalizarData(message.data)
    };
  }

  _chunkMensagens(messages = [], chunkSize = MAX_MESSAGES_PER_REQUEST) {
    const chunks = [];

    for (let i = 0; i < messages.length; i += chunkSize) {
      chunks.push(messages.slice(i, i + chunkSize));
    }

    return chunks;
  }

  _filtrarMensagensValidas(messages = []) {
    const validas = [];
    const invalidas = [];

    for (const item of messages) {
      const msg = this._normalizarMensagem(item);
      if (!msg.to || !Expo.isExpoPushToken(msg.to)) {
        invalidas.push({
          to: msg.to || null,
          reason: "invalid_expo_push_token"
        });
        continue;
      }

      validas.push(msg);
    }

    return { validas, invalidas };
  }

  async enviarEmMassa(messages = []) {
    const { validas, invalidas } = this._filtrarMensagensValidas(messages);
    if (validas.length === 0) {
      return {
        success: true,
        sent: 0,
        invalid: invalidas,
        tickets: []
      };
    }

    const chunks = this._chunkMensagens(validas, MAX_MESSAGES_PER_REQUEST);
    const tickets = [];

    for (const chunk of chunks) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }

    return {
      success: true,
      sent: validas.length,
      batches: chunks.length,
      invalid: invalidas,
      tickets
    };
  }

  async enviarUma(message = {}) {
    return this.enviarEmMassa([message]);
  }

  async enviarParaUsuarios(idUsuarios = [], payload = {}) {
    const ids = [...new Set(
      (Array.isArray(idUsuarios) ? idUsuarios : [])
        .map((item) => Number.parseInt(item, 10))
        .filter((item) => Number.isInteger(item) && item > 0)
    )];

    if (ids.length === 0) {
      return {
        success: true,
        sent: 0,
        invalid: [],
        tickets: [],
        batches: 0
      };
    }

    const rows = await postgres.query(
      `SELECT id_usuario, push_token
         FROM "condominio-bh".tb_usuario_push_tokens
        WHERE id_usuario IN (:ids)
          AND COALESCE(ativo, 1) = 1`,
      {
        replacements: { ids },
        type: QueryTypes.SELECT
      }
    );

    const messages = (rows || []).map((row) => ({
      to: row.push_token,
      title: payload.title,
      body: payload.body,
      sound: payload.sound || "default",
      data: payload.data
    }));

    return this.enviarEmMassa(messages);
  }
}

module.exports = new PushNotificationService();
