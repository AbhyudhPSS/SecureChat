import { sodium } from './sodium.js';
import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { toBase64 } from './encoding.js';

/**
 * File/attachment encryption.
 *
 * Each file is encrypted with its OWN fresh random key (XChaCha20-Poly1305). The
 * ciphertext blob is uploaded to object storage; the per-file key travels INSIDE
 * the E2EE message body (never to the server). The recipient downloads the blob
 * and decrypts it with that key.
 *
 * For very large files this whole-buffer approach should be replaced with a
 * chunked/streaming construction (libsodium secretstream) — noted in ROADMAP.
 */

export interface EncryptedFile {
  /** Random per-file key (base64) — placed inside the E2EE message, not on the server. */
  key: string;
  /** nonce‖ciphertext‖tag — uploaded to object storage as an opaque blob. */
  ciphertext: Uint8Array;
}

export function generateFileKey(): Uint8Array {
  return sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
}

/** Encrypt a file's bytes under a fresh random key. */
export function encryptFile(plaintext: Uint8Array): EncryptedFile {
  const key = generateFileKey();
  const ciphertext = aeadEncrypt(key, plaintext);
  return { key: toBase64(key), ciphertext };
}

/** Decrypt a downloaded blob with the per-file key carried in the message. */
export function decryptFile(key: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return aeadDecrypt(key, ciphertext);
}
