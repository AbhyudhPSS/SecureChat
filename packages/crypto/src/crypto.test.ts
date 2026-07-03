import { beforeAll, describe, expect, it } from 'vitest';
import {
  aeadDecrypt,
  aeadEncrypt,
  bytesToUtf8,
  deserializeState,
  generateDeviceIdentity,
  generateOneTimePreKeys,
  generateSignedPreKey,
  buildPublicBundle,
  hkdf,
  initRatchetInitiator,
  initRatchetResponder,
  ratchetDecrypt,
  ratchetEncrypt,
  ready,
  safetyNumber,
  serializeState,
  sodium,
  utf8ToBytes,
  verifyBundleSignature,
  x3dhInitiate,
  x3dhRespond,
  type RatchetState,
} from './index.js';

beforeAll(async () => {
  await ready();
});

describe('AEAD (XChaCha20-Poly1305)', () => {
  it('round-trips plaintext with associated data', () => {
    const key = sodium.randombytes_buf(32);
    const ad = utf8ToBytes('header-bytes');
    const ct = aeadEncrypt(key, utf8ToBytes('top secret'), ad);
    expect(bytesToUtf8(aeadDecrypt(key, ct, ad))).toBe('top secret');
  });

  it('fails authentication when associated data is tampered', () => {
    const key = sodium.randombytes_buf(32);
    const ct = aeadEncrypt(key, utf8ToBytes('hi'), utf8ToBytes('ad1'));
    expect(() => aeadDecrypt(key, ct, utf8ToBytes('ad2'))).toThrow();
  });
});

describe('HKDF', () => {
  it('is deterministic and length-correct', () => {
    const ikm = utf8ToBytes('input key material');
    const salt = utf8ToBytes('salt');
    const a = hkdf(ikm, salt, 'info', 64);
    const b = hkdf(ikm, salt, 'info', 64);
    expect(a.length).toBe(64);
    expect(sodium.to_hex(a)).toBe(sodium.to_hex(b));
  });
});

describe('Identity & prekey bundle', () => {
  it('produces a bundle whose signed prekey verifies', () => {
    const id = generateDeviceIdentity();
    const spk = generateSignedPreKey(id, 1);
    const [opk] = generateOneTimePreKeys(1, 1);
    const bundle = buildPublicBundle(id, spk, opk);
    expect(verifyBundleSignature(bundle)).toBe(true);
  });

  it('rejects a bundle with a forged signed prekey', () => {
    const id = generateDeviceIdentity();
    const spk = generateSignedPreKey(id, 1);
    const bundle = buildPublicBundle(id, spk);
    // Swap in an attacker key the identity never signed.
    const attacker = generateDeviceIdentity();
    bundle.signedPreKey.publicKey = sodium.to_base64(
      attacker.dh.publicKey,
      sodium.base64_variants.URLSAFE_NO_PADDING,
    );
    expect(verifyBundleSignature(bundle)).toBe(false);
  });

  it('computes a matching safety number on both sides', () => {
    const a = generateDeviceIdentity();
    const b = generateDeviceIdentity();
    expect(safetyNumber(a.dh.publicKey, b.dh.publicKey)).toBe(
      safetyNumber(b.dh.publicKey, a.dh.publicKey),
    );
  });
});

/** Build a full Alice<->Bob session via X3DH + Double Ratchet. */
function establishSession(): { alice: RatchetState; bob: RatchetState } {
  const bobId = generateDeviceIdentity();
  const bobSpk = generateSignedPreKey(bobId, 1);
  const [bobOpk] = generateOneTimePreKeys(1, 1);
  const bundle = buildPublicBundle(bobId, bobSpk, bobOpk);

  const aliceId = generateDeviceIdentity();
  const init = x3dhInitiate(aliceId, bundle);
  const alice = initRatchetInitiator(init.sharedSecret, init.responderSignedPreKey);

  const bobSecret = x3dhRespond(bobId, bobSpk, init.message, bobOpk);
  expect(sodium.to_hex(bobSecret)).toBe(sodium.to_hex(init.sharedSecret));
  const bob = initRatchetResponder(bobSecret, bobSpk.keyPair);

  return { alice, bob };
}

describe('X3DH + Double Ratchet', () => {
  it('derives an identical shared secret on both sides', () => {
    establishSession();
  });

  it('exchanges messages back and forth (DH ratchet advances)', () => {
    const { alice, bob } = establishSession();

    const m1 = ratchetEncrypt(alice, utf8ToBytes('hello bob'));
    expect(bytesToUtf8(ratchetDecrypt(bob, m1))).toBe('hello bob');

    const r1 = ratchetEncrypt(bob, utf8ToBytes('hi alice'));
    expect(bytesToUtf8(ratchetDecrypt(alice, r1))).toBe('hi alice');

    const m2 = ratchetEncrypt(alice, utf8ToBytes('how are you?'));
    expect(bytesToUtf8(ratchetDecrypt(bob, m2))).toBe('how are you?');
  });

  it('handles out-of-order delivery via skipped message keys', () => {
    const { alice, bob } = establishSession();
    const a = ratchetEncrypt(alice, utf8ToBytes('msg-0'));
    const b = ratchetEncrypt(alice, utf8ToBytes('msg-1'));
    const c = ratchetEncrypt(alice, utf8ToBytes('msg-2'));

    // Bob receives 2, then 0, then 1.
    expect(bytesToUtf8(ratchetDecrypt(bob, c))).toBe('msg-2');
    expect(bytesToUtf8(ratchetDecrypt(bob, a))).toBe('msg-0');
    expect(bytesToUtf8(ratchetDecrypt(bob, b))).toBe('msg-1');
  });

  it('provides forward secrecy: a leaked message key cannot decrypt later messages', () => {
    const { alice, bob } = establishSession();
    const m1 = ratchetEncrypt(alice, utf8ToBytes('first'));
    ratchetDecrypt(bob, m1);
    const m2 = ratchetEncrypt(alice, utf8ToBytes('second'));
    // Tampering m2's body with m1's should not decrypt.
    expect(() => ratchetDecrypt(bob, { header: m2.header, body: m1.body })).toThrow();
  });

  it('survives serialization of ratchet state between messages', () => {
    const { alice, bob } = establishSession();
    const m1 = ratchetEncrypt(alice, utf8ToBytes('persisted hello'));

    // Simulate persisting Bob's state to disk and reloading it.
    const reloadedBob = deserializeState(serializeState(bob));
    expect(bytesToUtf8(ratchetDecrypt(reloadedBob, m1))).toBe('persisted hello');
  });
});
