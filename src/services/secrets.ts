/**
 * Secret encryption at rest — AES-256-GCM keyed from JWT_SECRET (scrypt).
 *
 * Stored format: enc:v1:<iv b64>:<authTag b64>:<ciphertext b64>
 * Values without the prefix are treated as legacy plaintext (pre-encryption
 * rows) and returned as-is by decryptSecret, so no migration is needed.
 */

import crypto from 'crypto';

const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!cachedKey) {
    const secret = process.env.JWT_SECRET || 'launchforge-dev-secret-change-in-production';
    cachedKey = crypto.scryptSync(secret, 'launchforge-secrets', 32);
  }
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // legacy plaintext

  try {
    const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key (JWT_SECRET changed) — the secret is unrecoverable
    return '';
  }
}
