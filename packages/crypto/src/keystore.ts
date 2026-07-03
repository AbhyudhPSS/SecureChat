import { sodium } from './sodium.js';
import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { bytesToUtf8, fromBase64, toBase64, utf8ToBytes } from './encoding.js';

/**
 * Passphrase-wrapped key storage.
 *
 * The client keeps its private keys and serialized ratchet sessions on-device. At
 * rest they are encrypted ("wrapped") with a key derived from the user's
 * passphrase via Argon2id (`crypto_pwhash`). So reading the stored secrets
 * requires BOTH the device AND the passphrase — a stolen, locked device yields
 * only ciphertext.
 *
 * This module is environment-agnostic: the *where* (IndexedDB in the browser) is
 * the app's concern; this only does the wrapping crypto, so it can be unit-tested.
 */

/** Derive a 32-byte wrapping key from a passphrase + salt (Argon2id). */
export function deriveWrappingKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return sodium.crypto_pwhash(
    32,
    passphrase,
    salt,
    // INTERACTIVE params keep web/mobile login responsive while remaining
    // memory-hard. Tune upward for higher-value deployments.
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export function generateKeystoreSalt(): Uint8Array {
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
}

// Fixed 16-byte domain salt ("SC-auth-domain!!") for the server auth value. It is
// DELIBERATELY different from the random per-device keystore salts so the auth value
// and the key-wrapping key are independent one-way functions of the same password.
const AUTH_DOMAIN_SALT = new Uint8Array([
  0x53, 0x43, 0x2d, 0x61, 0x75, 0x74, 0x68, 0x2d, 0x64, 0x6f, 0x6d, 0x61, 0x69, 0x6e, 0x21, 0x21,
]);

/**
 * Derive the credential the client sends to the SERVER — a domain-separated,
 * one-way Argon2id function of the password, NOT the password itself.
 *
 * The server stores its own random-salted hash of this value and verifies against
 * it, so authentication is unchanged from the server's point of view. The point is
 * that the server never receives the raw password, so it can never re-derive the
 * on-device key-wrapping key (which is Argon2id(password, <random keystore salt>)).
 * A passive/curious server that logs credentials therefore cannot unwrap a user's
 * keys even if it also obtained the device's encrypted keystore.
 */
export function deriveAuthValue(password: string): string {
  const out = sodium.crypto_pwhash(
    32,
    password,
    AUTH_DOMAIN_SALT,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return toBase64(out);
}

/** The wrapped blob persisted by the client (both fields are base64 strings). */
export interface WrappedKeystore {
  v: 1;
  salt: string;
  blob: string; // AEAD(nonce‖ct‖tag) of JSON.stringify(data)
}

/** Encrypt an arbitrary JSON-serializable secret payload under a passphrase. */
export function encryptKeystore(passphrase: string, data: unknown): WrappedKeystore {
  const salt = generateKeystoreSalt();
  const key = deriveWrappingKey(passphrase, salt);
  const blob = aeadEncrypt(key, utf8ToBytes(JSON.stringify(data)));
  return { v: 1, salt: toBase64(salt), blob: toBase64(blob) };
}

/**
 * Decrypt a wrapped keystore. Throws if the passphrase is wrong (AEAD auth
 * failure) — callers should surface this as "incorrect passphrase".
 */
export function decryptKeystore<T = unknown>(passphrase: string, store: WrappedKeystore): T {
  const key = deriveWrappingKey(passphrase, fromBase64(store.salt));
  const plaintext = aeadDecrypt(key, fromBase64(store.blob));
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}
