// encryption.js — AES-256-GCM encryption for state files at rest
// Uses Node's built-in crypto — no extra dependencies.
// Key must be a 64-char hex string (32 bytes) set in MASTER_ENCRYPTION_KEY.

const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const k = process.env.MASTER_ENCRYPTION_KEY;
  if (!k) throw new Error('MASTER_ENCRYPTION_KEY not set — cannot encrypt/decrypt state files.');
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error('MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  return Buffer.from(k, 'hex');
}

// Returns a JSON string: { iv, ciphertext, tag }
function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), ciphertext, tag });
}

// Accepts the JSON string produced by encrypt()
function decrypt(encryptedJson) {
  const { iv, ciphertext, tag } = JSON.parse(encryptedJson);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

// Returns true if MASTER_ENCRYPTION_KEY is present and valid
function isEncryptionEnabled() {
  const k = process.env.MASTER_ENCRYPTION_KEY;
  return !!(k && /^[0-9a-fA-F]{64}$/.test(k));
}

module.exports = { encrypt, decrypt, isEncryptionEnabled };
