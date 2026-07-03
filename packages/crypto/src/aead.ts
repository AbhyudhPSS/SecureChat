import { sodium } from './sodium.js';
import { concatBytes } from './encoding.js';

/**
 * Authenticated encryption with XChaCha20-Poly1305 (IETF). XChaCha20 uses a
 * 192-bit nonce, so random nonces are safe without a counter — we generate a
 * fresh random nonce per message and prepend it to the ciphertext.
 *
 * `associatedData` is authenticated but not encrypted; the Double Ratchet uses
 * it to bind each ciphertext to its message header.
 *
 * IMPORTANT: libsodium's constants are only populated AFTER `ready()` resolves.
 * In Node's sumo build they happen to be ready at import; in the browser the WASM
 * initializes asynchronously, so we read these constants at call time — never at
 * module load — to stay correct across environments.
 */

export const aeadKeyBytes = (): number => sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
export const aeadNonceBytes = (): number => sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;

export function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const nonce = sodium.randombytes_buf(aeadNonceBytes());
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData,
    null,
    nonce,
    key,
  );
  // Wire layout: nonce || ciphertext+tag
  return concatBytes(nonce, ciphertext);
}

export function aeadDecrypt(
  key: Uint8Array,
  nonceAndCiphertext: Uint8Array,
  associatedData: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const nonceBytes = aeadNonceBytes();
  if (nonceAndCiphertext.length < nonceBytes) {
    throw new Error('aeadDecrypt: input too short');
  }
  const nonce = nonceAndCiphertext.subarray(0, nonceBytes);
  const ciphertext = nonceAndCiphertext.subarray(nonceBytes);
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    associatedData,
    nonce,
    key,
  );
}
