'use strict';

const { QueryTypes } = require('sequelize');
const postgres = require('../database/postgres');
const credentialCipher = require('../integrations/shared/credentialCipher');
const bankingProviderRegistry = require('../integrations/bankingProviderRegistry');

const PERFIS_GESTAO = new Set(['Admin', 'Sindico', 'Sub-Sindico']);
const AMBIENTES_VALIDOS = new Set(['sandbox', 'production']);

class IntegracaoBancariaController {
  _isGestor(req) {
    return PERFIS_GESTAO.has(req.nomePerfil);
  }

  _normalizarTextoOuNull(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  }

  /**
   * Formato exposto ao front — nunca inclui colunas cifradas
   * (client_secret_cifrado, certificado_cifrado, chave_privada_cifrada,
   * access_token_cifrado), nem mascaradas.
   */
  _serializar(row) {
    return {
      id: row.id,
      provider: row.provider,
      ambiente: row.ambiente,
      client_id: row.client_id,
      conta_corrente: row.conta_corrente,
      agencia: row.agencia,
      chave_pix: row.chave_pix,
      status_conexao: row.status_conexao,
      ultimo_erro: row.ultimo_erro,
      ultima_verificacao_em: row.ultima_verificacao_em,
      ativo: row.ativo,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // ─── Listagem ───────────────────────────────────────────────────────────

  async listarIntegracoes(req, res) {
    try {
      const rows = await postgres.query(
        `SELECT id, provider, ambiente, client_id, conta_corrente, agencia, chave_pix,
                status_conexao, ultimo_erro, ultima_verificacao_em, ativo, created_at, updated_at
           FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id_condominio = :idCondominio
            AND ativo = true
          ORDER BY provider, ambiente`,
        { replacements: { idCondominio: req.id_condominio }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data: rows.map((row) => this._serializar(row)) });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao listar integrações bancárias.', detail: error.message });
    }
  }

  // ─── Conectar (upload de credenciais) ──────────────────────────────────

  async conectarInter(req, res) {
    try {
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const clientId = this._normalizarTextoOuNull(req.body.client_id);
      const clientSecret = this._normalizarTextoOuNull(req.body.client_secret);
      const ambiente = this._normalizarTextoOuNull(req.body.ambiente) || 'production';

      if (!clientId || !clientSecret) {
        return res.status(422).json({ message: 'client_id e client_secret são obrigatórios.' });
      }
      if (!AMBIENTES_VALIDOS.has(ambiente)) {
        return res.status(422).json({ message: 'ambiente deve ser "sandbox" ou "production".' });
      }

      const arquivoCertificado = req.files?.certificado?.[0];
      const arquivoChave = req.files?.chave_privada?.[0];
      if (!arquivoCertificado || !arquivoChave) {
        return res.status(422).json({ message: 'É necessário enviar os arquivos "certificado" e "chave_privada".' });
      }

      const certificadoBase64 = arquivoCertificado.buffer.toString('base64');
      const chavePrivadaBase64 = arquivoChave.buffer.toString('base64');

      const provider = bankingProviderRegistry.getProvider('inter');
      const teste = await provider.testarConexao({
        ambiente,
        clientId,
        clientSecret,
        certificadoBase64,
        chavePrivadaBase64,
      });

      if (!teste.ok) {
        return res.status(422).json({ message: 'Não foi possível validar a conexão com o Inter.', detail: teste.erro });
      }

      const clientSecretCifrado = credentialCipher.encrypt(clientSecret);
      const certificadoCifrado = credentialCipher.encrypt(certificadoBase64);
      const chavePrivadaCifrada = credentialCipher.encrypt(chavePrivadaBase64);

      const [existente] = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id_condominio = :idCondominio AND provider = 'inter' AND ambiente = :ambiente`,
        { replacements: { idCondominio: req.id_condominio, ambiente }, type: QueryTypes.SELECT }
      );

      let idIntegracao;
      if (existente) {
        idIntegracao = existente.id;
        await postgres.query(
          `UPDATE "condominio-bh".tb_fin_integracao_bancaria
              SET client_id = :clientId,
                  client_secret_cifrado = :clientSecretCifrado,
                  certificado_cifrado = :certificadoCifrado,
                  chave_privada_cifrada = :chavePrivadaCifrada,
                  status_conexao = 'ativo',
                  ultimo_erro = NULL,
                  ultima_verificacao_em = NOW(),
                  access_token_cifrado = NULL,
                  access_token_expira_em = NULL,
                  ativo = true,
                  updated_at = NOW()
            WHERE id = :id`,
          {
            replacements: { id: idIntegracao, clientId, clientSecretCifrado, certificadoCifrado, chavePrivadaCifrada },
            type: QueryTypes.UPDATE,
          }
        );
      } else {
        const [rows] = await postgres.query(
          `INSERT INTO "condominio-bh".tb_fin_integracao_bancaria
             (id_condominio, provider, ambiente, client_id, client_secret_cifrado,
              certificado_cifrado, chave_privada_cifrada, status_conexao,
              ultima_verificacao_em, id_usuario_cadastro)
           VALUES (:idCondominio, 'inter', :ambiente, :clientId, :clientSecretCifrado,
                   :certificadoCifrado, :chavePrivadaCifrada, 'ativo',
                   NOW(), :idUsuarioCadastro)
           RETURNING id`,
          {
            replacements: {
              idCondominio: req.id_condominio,
              ambiente,
              clientId,
              clientSecretCifrado,
              certificadoCifrado,
              chavePrivadaCifrada,
              idUsuarioCadastro: req.idcliente,
            },
            type: QueryTypes.INSERT,
          }
        );
        idIntegracao = rows[0].id;
      }

      const [linhaFinal] = await postgres.query(
        `SELECT id, provider, ambiente, client_id, conta_corrente, agencia, chave_pix,
                status_conexao, ultimo_erro, ultima_verificacao_em, ativo, created_at, updated_at
           FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id = :id`,
        { replacements: { id: idIntegracao }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data: this._serializar(linhaFinal) });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao conectar integração bancária.', detail: error.message });
    }
  }

  // ─── Conectar Itaú (client_id/client_secret + certificado opcional) ────

  async conectarItau(req, res) {
    try {
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const clientId = this._normalizarTextoOuNull(req.body.client_id);
      const clientSecret = this._normalizarTextoOuNull(req.body.client_secret);
      const ambiente = this._normalizarTextoOuNull(req.body.ambiente) || 'production';

      if (!clientId || !clientSecret) {
        return res.status(422).json({ message: 'client_id e client_secret são obrigatórios.' });
      }
      if (!AMBIENTES_VALIDOS.has(ambiente)) {
        return res.status(422).json({ message: 'ambiente deve ser "sandbox" ou "production".' });
      }

      // TODO confirmar contra sandbox real se o Itaú exige certificado mTLS
      // (diferente do Inter, onde é sempre obrigatório) — por ora, opcional.
      const arquivoCertificado = req.files?.certificado?.[0];
      const arquivoChave = req.files?.chave_privada?.[0];
      const certificadoBase64 = arquivoCertificado ? arquivoCertificado.buffer.toString('base64') : null;
      const chavePrivadaBase64 = arquivoChave ? arquivoChave.buffer.toString('base64') : null;

      const provider = bankingProviderRegistry.getProvider('itau');
      const teste = await provider.testarConexao({
        ambiente,
        clientId,
        clientSecret,
        certificadoBase64: certificadoBase64 || undefined,
        chavePrivadaBase64: chavePrivadaBase64 || undefined,
      });

      if (!teste.ok) {
        return res.status(422).json({ message: 'Não foi possível validar a conexão com o Itaú.', detail: teste.erro });
      }

      const clientSecretCifrado = credentialCipher.encrypt(clientSecret);
      const certificadoCifrado = certificadoBase64 ? credentialCipher.encrypt(certificadoBase64) : null;
      const chavePrivadaCifrada = chavePrivadaBase64 ? credentialCipher.encrypt(chavePrivadaBase64) : null;

      const [existente] = await postgres.query(
        `SELECT id FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id_condominio = :idCondominio AND provider = 'itau' AND ambiente = :ambiente`,
        { replacements: { idCondominio: req.id_condominio, ambiente }, type: QueryTypes.SELECT }
      );

      let idIntegracao;
      if (existente) {
        idIntegracao = existente.id;
        await postgres.query(
          `UPDATE "condominio-bh".tb_fin_integracao_bancaria
              SET client_id = :clientId,
                  client_secret_cifrado = :clientSecretCifrado,
                  certificado_cifrado = :certificadoCifrado,
                  chave_privada_cifrada = :chavePrivadaCifrada,
                  status_conexao = 'ativo',
                  ultimo_erro = NULL,
                  ultima_verificacao_em = NOW(),
                  access_token_cifrado = NULL,
                  access_token_expira_em = NULL,
                  ativo = true,
                  updated_at = NOW()
            WHERE id = :id`,
          {
            replacements: { id: idIntegracao, clientId, clientSecretCifrado, certificadoCifrado, chavePrivadaCifrada },
            type: QueryTypes.UPDATE,
          }
        );
      } else {
        const [rows] = await postgres.query(
          `INSERT INTO "condominio-bh".tb_fin_integracao_bancaria
             (id_condominio, provider, ambiente, client_id, client_secret_cifrado,
              certificado_cifrado, chave_privada_cifrada, status_conexao,
              ultima_verificacao_em, id_usuario_cadastro)
           VALUES (:idCondominio, 'itau', :ambiente, :clientId, :clientSecretCifrado,
                   :certificadoCifrado, :chavePrivadaCifrada, 'ativo',
                   NOW(), :idUsuarioCadastro)
           RETURNING id`,
          {
            replacements: {
              idCondominio: req.id_condominio,
              ambiente,
              clientId,
              clientSecretCifrado,
              certificadoCifrado,
              chavePrivadaCifrada,
              idUsuarioCadastro: req.idcliente,
            },
            type: QueryTypes.INSERT,
          }
        );
        idIntegracao = rows[0].id;
      }

      const [linhaFinal] = await postgres.query(
        `SELECT id, provider, ambiente, client_id, conta_corrente, agencia, chave_pix,
                status_conexao, ultimo_erro, ultima_verificacao_em, ativo, created_at, updated_at
           FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id = :id`,
        { replacements: { id: idIntegracao }, type: QueryTypes.SELECT }
      );

      return res.status(200).json({ data: this._serializar(linhaFinal) });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao conectar integração bancária.', detail: error.message });
    }
  }

  // ─── Testar conexão sob demanda ────────────────────────────────────────

  async testarIntegracao(req, res) {
    try {
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._normalizarTextoOuNull(req.params.id);
      const [credencial] = await postgres.query(
        `SELECT * FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id = :id AND id_condominio = :idCondominio AND ativo = true`,
        { replacements: { id, idCondominio: req.id_condominio }, type: QueryTypes.SELECT }
      );

      if (!credencial) return res.status(404).json({ message: 'Integração não encontrada.' });

      const provider = bankingProviderRegistry.getProvider(credencial.provider);
      const teste = await provider.testarConexao({
        ambiente: credencial.ambiente,
        clientId: credencial.client_id,
        clientSecret: credentialCipher.decrypt(credencial.client_secret_cifrado),
        certificadoBase64: credentialCipher.decrypt(credencial.certificado_cifrado),
        chavePrivadaBase64: credentialCipher.decrypt(credencial.chave_privada_cifrada),
      });

      await postgres.query(
        `UPDATE "condominio-bh".tb_fin_integracao_bancaria
            SET status_conexao = :status, ultimo_erro = :ultimoErro,
                ultima_verificacao_em = NOW(), updated_at = NOW()
          WHERE id = :id`,
        {
          replacements: {
            id: credencial.id,
            status: teste.ok ? 'ativo' : 'erro',
            ultimoErro: teste.ok ? null : teste.erro,
          },
          type: QueryTypes.UPDATE,
        }
      );

      return res.status(200).json({ ok: teste.ok, erro: teste.ok ? undefined : teste.erro });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao testar integração bancária.', detail: error.message });
    }
  }

  // ─── Consultar saldo ────────────────────────────────────────────────────

  async consultarSaldo(req, res) {
    try {
      const id = this._normalizarTextoOuNull(req.params.id);
      const [credencial] = await postgres.query(
        `SELECT * FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id = :id AND id_condominio = :idCondominio AND ativo = true`,
        { replacements: { id, idCondominio: req.id_condominio }, type: QueryTypes.SELECT }
      );

      if (!credencial) return res.status(404).json({ message: 'Integração não encontrada.' });

      const provider = bankingProviderRegistry.getProvider(credencial.provider);
      const resultado = await provider.consultarSaldo(credencial);

      return res.status(200).json({
        saldo: resultado.disponivel,
        atualizado_em: resultado.atualizadoEm,
      });
    } catch (error) {
      return res.status(502).json({ message: 'Falha ao consultar saldo bancário.', detail: error.message });
    }
  }

  // ─── Consultar extrato ──────────────────────────────────────────────────

  async consultarExtrato(req, res) {
    try {
      const id = this._normalizarTextoOuNull(req.params.id);
      const dataInicio = this._normalizarTextoOuNull(req.query.dataInicio);
      const dataFim = this._normalizarTextoOuNull(req.query.dataFim);

      if (!dataInicio || !dataFim) {
        return res.status(422).json({ message: 'dataInicio e dataFim são obrigatórios.' });
      }

      const [credencial] = await postgres.query(
        `SELECT * FROM "condominio-bh".tb_fin_integracao_bancaria
          WHERE id = :id AND id_condominio = :idCondominio AND ativo = true`,
        { replacements: { id, idCondominio: req.id_condominio }, type: QueryTypes.SELECT }
      );

      if (!credencial) return res.status(404).json({ message: 'Integração não encontrada.' });

      const provider = bankingProviderRegistry.getProvider(credencial.provider);
      const transacoes = await provider.consultarExtrato(credencial, dataInicio, dataFim);

      return res.status(200).json({ data: transacoes });
    } catch (error) {
      return res.status(502).json({ message: 'Falha ao consultar extrato bancário.', detail: error.message });
    }
  }

  // ─── Desativar ──────────────────────────────────────────────────────────

  async desativarIntegracao(req, res) {
    try {
      if (!this._isGestor(req)) return res.status(403).json({ message: 'Acesso negado.' });

      const id = this._normalizarTextoOuNull(req.params.id);
      const [result] = await postgres.query(
        `UPDATE "condominio-bh".tb_fin_integracao_bancaria
            SET ativo = false, updated_at = NOW()
          WHERE id = :id AND id_condominio = :idCondominio
          RETURNING id`,
        { replacements: { id, idCondominio: req.id_condominio }, type: QueryTypes.UPDATE }
      );

      if (!result || result.length === 0) {
        return res.status(404).json({ message: 'Integração não encontrada.' });
      }

      return res.status(200).json({ message: 'Integração desativada.' });
    } catch (error) {
      return res.status(500).json({ message: 'Falha ao desativar integração bancária.', detail: error.message });
    }
  }
}

module.exports = IntegracaoBancariaController;
