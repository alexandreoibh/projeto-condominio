const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const pushNotificationService = require('../service/pushNotificationService');

class UsuarioController {
  _toInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  _normalizarTexto(value) {
    return String(value || '').trim();
  }

  _isErroTipoPush(error) {
    return String(error?.message || '').toLowerCase().includes('tipo de push invalido');
  }

  async salvarPushToken(req, res) {
    try {
      const idUsuario = this._toInt(req.idcliente);
      if (!idUsuario) {
        return res.status(401).json({ message: 'Usuário não autenticado.' });
      }

      const token = String(req.body?.token || '').trim();
      const plataforma = String(req.body?.plataforma || '').trim().toLowerCase();

      await postgres.query(
        `INSERT INTO "condominio-bh".tb_usuario_push_tokens (
            id_usuario,
            push_token,
            plataforma,
            ativo,
            created_at,
            updated_at
          ) VALUES (
            :id_usuario,
            :push_token,
            :plataforma,
            1,
            now(),
            now()
          )
          ON CONFLICT (push_token)
          DO UPDATE SET
            id_usuario = EXCLUDED.id_usuario,
            plataforma = EXCLUDED.plataforma,
            ativo = 1,
            updated_at = now()`,
        {
          replacements: {
            id_usuario: idUsuario,
            push_token: token,
            plataforma: plataforma
          },
          type: QueryTypes.INSERT
        }
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao salvar push token.',
        detail: error.message
      });
    }
  }

  async enviarPushTeste(req, res) {
    try {
      const idUsuario = this._toInt(req.body?.id_usuario);
      const to = this._normalizarTexto(req.body?.to);

      const payload = {
        title: this._normalizarTexto(req.body?.title),
        body: this._normalizarTexto(req.body?.body),
        sound: this._normalizarTexto(req.body?.sound) || 'default',
        data: req.body?.data && typeof req.body.data === 'object' ? req.body.data : {}
      };

      const resultado = idUsuario
        ? await pushNotificationService.enviarParaUsuarios([idUsuario], payload)
        : await pushNotificationService.enviarUma({
            to,
            ...payload
          });

      return res.status(200).json({
        success: true,
        mode: idUsuario ? 'user' : 'token',
        ...resultado
      });
    } catch (error) {
      if (this._isErroTipoPush(error)) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Erro ao enviar push de teste.',
        detail: error.message
      });
    }
  }

  async enviarPushTesteMassa(req, res) {
    try {
      const mensagens = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const idsUsuarios = Array.isArray(req.body?.id_usuarios) ? req.body.id_usuarios : [];

      if (mensagens.length > 0) {
        const resultado = await pushNotificationService.enviarEmMassa(mensagens);
        return res.status(200).json({
          success: true,
          mode: 'messages',
          ...resultado
        });
      }

      const payload = {
        title: this._normalizarTexto(req.body?.title),
        body: this._normalizarTexto(req.body?.body),
        sound: this._normalizarTexto(req.body?.sound) || 'default',
        data: req.body?.data && typeof req.body.data === 'object' ? req.body.data : {}
      };

      const resultado = await pushNotificationService.enviarParaUsuarios(idsUsuarios, payload);

      return res.status(200).json({
        success: true,
        mode: 'users',
        ...resultado
      });
    } catch (error) {
      if (this._isErroTipoPush(error)) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Erro ao enviar push em massa.',
        detail: error.message
      });
    }
  }
}

module.exports = UsuarioController;
