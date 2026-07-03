import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptKeystore,
  encryptKeystore,
  generateDeviceIdentity,
  ready,
  toBase64,
} from './index.js';

beforeAll(async () => {
  await ready();
});

describe('Passphrase keystore', () => {
  it('round-trips a secret payload under the correct passphrase', () => {
    const id = generateDeviceIdentity();
    const secret = {
      identityPriv: toBase64(id.dh.privateKey),
      signingPriv: toBase64(id.signing.privateKey),
    };
    const wrapped = encryptKeystore('correct horse battery staple', secret);
    const out = decryptKeystore<typeof secret>('correct horse battery staple', wrapped);
    expect(out).toEqual(secret);
  });

  it('produces a versioned, fully-base64 envelope (no plaintext leakage)', () => {
    const wrapped = encryptKeystore('pw', { hello: 'world' });
    expect(wrapped.v).toBe(1);
    expect(wrapped.blob).not.toContain('world');
  });

  it('uses a fresh random salt each time (different ciphertext for same input)', () => {
    const a = encryptKeystore('pw', { x: 1 });
    const b = encryptKeystore('pw', { x: 1 });
    expect(a.salt).not.toBe(b.salt);
    expect(a.blob).not.toBe(b.blob);
  });

  it('fails to decrypt with the wrong passphrase', () => {
    const wrapped = encryptKeystore('right-passphrase', { secret: 42 });
    expect(() => decryptKeystore('wrong-passphrase', wrapped)).toThrow();
  });
});
