'use strict';

const { QueryTypes } = require('sequelize');
const postgres = require('../../database/postgres');
const credentialCipher = require('../shared/credentialCipher');
const { requisitarToken } = require('./itauHttpClient');

// Cache L1 por processo — mesmo padrão de interAuthClient.js: evita
// round-trip ao Postgres dentro da mesma invocação/instância quente. A
// fonte de verdade fica no banco (access_token_cifrado/access_token_expira_em
// de tb_fin_integracao_bancaria), porque em Vercel cada instância fria não
// compartilha este Map.
const cacheLocal = new Map(); // id_integracao -> { accessToken, expiraEm }

const MARGEM_EXPIRACAO_MS = 60 * 1000;

function _tokenValido(expiraEm) {
  return expiraEm && new Date(expiraEm).getTime() - MARGEM_EXPIRACAO_MS > Date.now();
}

/**
 * @param {object} credencial Linha de tb_fin_integracao_bancaria (com campos
 *   *_cifrado ainda cifrados — este módulo é quem decifra).
 * @returns {Promise<string>} access_token válido.
 */
async function obterAccessToken(credencial) {
  const cacheado = cacheLocal.get(credencial.id);
  if (cacheado && _tokenValido(cacheado.expiraEm)) {
    return cacheado.accessToken;
  }

  // Outra instância pode ter renovado — relê antes de pedir um novo.
  const [linhaAtual] = await postgres.query(
    `SELECT access_token_cifrado, access_token_expira_em
       FROM "condominio-bh".tb_fin_integracao_bancaria
      WHERE id = :id`,
    { replacements: { id: credencial.id }, type: QueryTypes.SELECT }
  );

  if (linhaAtual?.access_token_cifrado && _tokenValido(linhaAtual.access_token_expira_em)) {
    const accessToken = credentialCipher.decrypt(linhaAtual.access_token_cifrado);
    cacheLocal.set(credencial.id, { accessToken, expiraEm: linhaAtual.access_token_expira_em });
    return accessToken;
  }

  const clientSecret = credentialCipher.decrypt(credencial.client_secret_cifrado);
  const certificadoBase64 = credencial.certificado_cifrado ? credentialCipher.decrypt(credencial.certificado_cifrado) : undefined;
  const chavePrivadaBase64 = credencial.chave_privada_cifrada ? credentialCipher.decrypt(credencial.chave_privada_cifrada) : undefined;

  const resultado = await requisitarToken({
    ambiente: credencial.ambiente,
    clientId: credencial.client_id,
    clientSecret,
    certificadoBase64,
    chavePrivadaBase64,
  });

  const expiraEm = new Date(Date.now() + resultado.expires_in * 1000);
  const accessTokenCifrado = credentialCipher.encrypt(resultado.access_token);

  await postgres.query(
    `UPDATE "condominio-bh".tb_fin_integracao_bancaria
        SET access_token_cifrado = :accessTokenCifrado,
            access_token_expira_em = :expiraEm,
            updated_at = NOW()
      WHERE id = :id`,
    {
      replacements: { id: credencial.id, accessTokenCifrado, expiraEm },
      type: QueryTypes.UPDATE,
    }
  );

  cacheLocal.set(credencial.id, { accessToken: resultado.access_token, expiraEm });
  return resultado.access_token;
}

/**
 * Faz só o passo de autenticação, sem persistir nada — usado no cadastro
 * da credencial para validar client_id/secret (e certificado, se enviado)
 * antes de salvar.
 *
 * @param {object} params
 * @param {string} params.ambiente
 * @param {string} params.clientId
 * @param {string} params.clientSecret texto em claro (ainda não cifrado).
 * @param {string} [params.certificadoBase64] texto em claro.
 * @param {string} [params.chavePrivadaBase64] texto em claro.
 * @returns {Promise<{ok: boolean, erro?: string}>}
 */
async function testarConexao({ ambiente, clientId, clientSecret, certificadoBase64, chavePrivadaBase64 }) {
  try {
    await requisitarToken({ ambiente, clientId, clientSecret, certificadoBase64, chavePrivadaBase64 });
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

module.exports = { obterAccessToken, testarConexao };
