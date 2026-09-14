'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function _obterChaveMestra() {
  const chave = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!chave) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY não configurada — obrigatória para cifrar/decifrar credenciais bancárias.');
  }
  const buffer = Buffer.from(chave, 'base64');
  if (buffer.length !== 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY deve decodificar (base64) para exatamente 32 bytes (AES-256).');
  }
  return buffer;
}

/**
 * Cifra um texto em claro (client_secret, certificado/chave em base64, etc.)
 * @param {string} textoClaro
 * @returns {string} `${iv}:${authTag}:${cifrado}` em base64, concatenado por ":"
 */
function encrypt(textoClaro) {
  const chave = _obterChaveMestra();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, chave, iv);
  const cifrado = Buffer.concat([cipher.update(String(textoClaro), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), cifrado.toString('base64')].join(':');
}

/**
 * @param {string} textoCifrado Saída de `encrypt()`.
 * @returns {string} Texto em claro original.
 */
function decrypt(textoCifrado) {
  const chave = _obterChaveMestra();
  const [ivB64, authTagB64, cifradoB64] = String(textoCifrado).split(':');
  if (!ivB64 || !authTagB64 || !cifradoB64) {
    throw new Error('Formato inválido de valor cifrado.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, chave, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decifrado = Buffer.concat([decipher.update(Buffer.from(cifradoB64, 'base64')), decipher.final()]);
  return decifrado.toString('utf8');
}

module.exports = { encrypt, decrypt };
