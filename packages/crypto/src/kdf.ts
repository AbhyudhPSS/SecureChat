import { sodium } from './sodium.js';
import { concatBytes, utf8ToBytes } from './encoding.js';

/**
 * HKDF (RFC 5869) built on HMAC-SHA-256, which libsodium exposes as
 * `crypto_auth_hmacsha256`. We implement HKDF explicitly (rather than reaching
 * for libsodium's BLAKE2b-based `crypto_kdf`) so the construction matches the
 * Signal specification's expectations and is easy to audit against RFC 5869.
 */

const HASH_LEN = 32; // SHA-256 output size

function hmac(key: Uint8Array, message: Uint8Array): Uint8Array {
  return sodium.crypto_auth_hmacsha256(message, key);
}

/** HKDF-Extract: derive a pseudorandom key from input keying material. */
export function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
  // crypto_auth_hmacsha256 requires a 32-byte key; pad/normalize the salt.
  const normalizedSalt =
    salt.length === HASH_LEN ? salt : sodium.crypto_generichash(HASH_LEN, salt, null);
  return hmac(normalizedSalt, ikm);
}

/** HKDF-Expand: expand a pseudorandom key into `length` bytes of output. */
export function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const n = Math.ceil(length / HASH_LEN);
  if (n > 255) throw new Error('hkdfExpand: requested length too large');
  let t = new Uint8Array(0);
  const okm = new Uint8Array(n * HASH_LEN);
  for (let i = 0; i < n; i++) {
    t = hmac(prk, concatBytes(t, info, Uint8Array.of(i + 1)));
    okm.set(t, i * HASH_LEN);
  }
  return okm.slice(0, length);
}

/** Convenience: full HKDF (extract then expand). */
export function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string | Uint8Array,
  length: number,
): Uint8Array {
  const infoBytes = typeof info === 'string' ? utf8ToBytes(info) : info;
  return hkdfExpand(hkdfExtract(salt, ikm), infoBytes, length);
}
