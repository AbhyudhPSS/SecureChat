import { beforeAll, describe, expect, it } from 'vitest';
import {
  generateDeviceIdentity,
  openSealed,
  pad,
  ready,
  sealTo,
  sodium,
  unpad,
  utf8ToBytes,
  bytesToUtf8,
} from './index.js';

beforeAll(async () => {
  await ready();
});

describe('Padding (length hiding)', () => {
  it('round-trips and pads to a bucket multiple', () => {
    for (const len of [0, 1, 5, 255, 256, 257, 1000]) {
      const data = sodium.randombytes_buf(len);
      const padded = pad(data);
      expect(padded.length % 256).toBe(0);
      expect(padded.length).toBeGreaterThan(data.length);
      expect(sodium.to_hex(unpad(padded))).toBe(sodium.to_hex(data));
    }
  });

  it('hides exact length: different short messages share a padded size', () => {
    expect(pad(utf8ToBytes('hi')).length).toBe(pad(utf8ToBytes('a much longer but still short message')).length);
  });

  it('rejects corrupted padding', () => {
    expect(() => unpad(sodium.randombytes_buf(256))).toThrow();
  });
});

describe('Sealed sender', () => {
  it('lets the recipient open a sealed message without any sender key', () => {
    const recipient = generateDeviceIdentity();
    const sealed = sealTo(recipient.dh.publicKey, utf8ToBytes('from an anonymous sender'));
    expect(bytesToUtf8(openSealed(recipient.dh, sealed))).toBe('from an anonymous sender');
  });

  it('carries no sender identity (different ciphertext each time, no sender key needed)', () => {
    const recipient = generateDeviceIdentity();
    const a = sealTo(recipient.dh.publicKey, utf8ToBytes('x'));
    const b = sealTo(recipient.dh.publicKey, utf8ToBytes('x'));
    expect(sodium.to_hex(a)).not.toBe(sodium.to_hex(b)); // ephemeral sender key each time
  });

  it('only the intended recipient can open it', () => {
    const recipient = generateDeviceIdentity();
    const attacker = generateDeviceIdentity();
    const sealed = sealTo(recipient.dh.publicKey, utf8ToBytes('secret'));
    expect(() => openSealed(attacker.dh, sealed)).toThrow();
  });
});
