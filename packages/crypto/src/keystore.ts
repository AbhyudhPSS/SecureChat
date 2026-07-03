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
