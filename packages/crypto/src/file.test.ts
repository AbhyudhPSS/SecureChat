import { beforeAll, describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, fromBase64, ready, sodium } from './index.js';

beforeAll(async () => {
  await ready();
});

describe('File encryption', () => {
  it('round-trips binary data under a fresh per-file key', () => {
    const data = sodium.randombytes_buf(4096);
    const enc = encryptFile(data);
    const out = decryptFile(fromBase64(enc.key), enc.ciphertext);
    expect(sodium.to_hex(out)).toBe(sodium.to_hex(data));
  });

  it('uses a different key (and ciphertext) for each file', () => {
    const data = sodium.randombytes_buf(64);
    const a = encryptFile(data);
    const b = encryptFile(data);
    expect(a.key).not.toBe(b.key);
    expect(sodium.to_hex(a.ciphertext)).not.toBe(sodium.to_hex(b.ciphertext));
  });

  it('fails to decrypt with the wrong key', () => {
    const enc = encryptFile(sodium.randombytes_buf(128));
    const wrongKey = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
    expect(() => decryptFile(wrongKey, enc.ciphertext)).toThrow();
  });
});
