import { sodium } from './sodium.js';
import { toBase64, fromBase64 } from './encoding.js';

/**
 * Identity & prekey material (the "X3DH key infrastructure").
 *
 * Each user/device holds:
 *   - a long-term Ed25519 signing key  (proves authorship of prekeys)
 *   - a long-term X25519 identity key   (used for Diffie-Hellman in X3DH)
 *   - one signed prekey (X25519, rotated periodically, signed by the Ed25519 key)
 *   - a batch of one-time prekeys (X25519, consumed one per new session)
 *
 * Only PUBLIC halves are ever uploaded to the server (the "prekey bundle").
 * Private keys never leave the device.
 */

export interface RawKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface DeviceIdentity {
  signing: RawKeyPair; // Ed25519
  dh: RawKeyPair; // X25519 identity key
}

export interface SignedPreKey {
  keyId: number;
  keyPair: RawKeyPair; // X25519
  signature: Uint8Array; // Ed25519 signature over the public key
}

export interface OneTimePreKey {
  keyId: number;
  keyPair: RawKeyPair; // X25519
}

/** What gets serialized and uploaded to the server (public material only). */
export interface PublicPreKeyBundle {
  signingPublicKey: string; // Ed25519 public (base64)
  identityPublicKey: string; // X25519 public (base64)
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  oneTimePreKey?: {
    keyId: number;
    publicKey: string;
  };
}

export function generateDeviceIdentity(): DeviceIdentity {
  const signing = sodium.crypto_sign_keypair(); // Ed25519
  const dh = sodium.crypto_box_keypair(); // X25519
  return {
    signing: { publicKey: signing.publicKey, privateKey: signing.privateKey },
    dh: { publicKey: dh.publicKey, privateKey: dh.privateKey },
  };
}

export function generateSignedPreKey(identity: DeviceIdentity, keyId: number): SignedPreKey {
  const kp = sodium.crypto_box_keypair();
  const signature = sodium.crypto_sign_detached(kp.publicKey, identity.signing.privateKey);
  return { keyId, keyPair: { publicKey: kp.publicKey, privateKey: kp.privateKey }, signature };
}

export function generateOneTimePreKeys(count: number, startKeyId = 1): OneTimePreKey[] {
  const keys: OneTimePreKey[] = [];
  for (let i = 0; i < count; i++) {
    const kp = sodium.crypto_box_keypair();
    keys.push({
      keyId: startKeyId + i,
      keyPair: { publicKey: kp.publicKey, privateKey: kp.privateKey },
    });
  }
  return keys;
}

/** Assemble the public bundle a peer needs to start a session with us. */
export function buildPublicBundle(
  identity: DeviceIdentity,
  signedPreKey: SignedPreKey,
  oneTimePreKey?: OneTimePreKey,
): PublicPreKeyBundle {
  return {
    signingPublicKey: toBase64(identity.signing.publicKey),
    identityPublicKey: toBase64(identity.dh.publicKey),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: toBase64(signedPreKey.keyPair.publicKey),
      signature: toBase64(signedPreKey.signature),
    },
    oneTimePreKey: oneTimePreKey
      ? { keyId: oneTimePreKey.keyId, publicKey: toBase64(oneTimePreKey.keyPair.publicKey) }
      : undefined,
  };
}

/**
 * Verify that the signed prekey in a fetched bundle was actually signed by the
 * advertised identity. A peer MUST call this before trusting a bundle, otherwise
 * a malicious server could substitute its own prekey (a MITM attempt).
 */
export function verifyBundleSignature(bundle: PublicPreKeyBundle): boolean {
  return sodium.crypto_sign_verify_detached(
    fromBase64(bundle.signedPreKey.signature),
    fromBase64(bundle.signedPreKey.publicKey),
    fromBase64(bundle.signingPublicKey),
  );
}

/**
 * Safety number: a stable, human-comparable fingerprint of two identities, used
 * for out-of-band verification (the "60-digit safety number" / QR scan in
 * Signal). Both sides compute the same value regardless of ordering.
 */
export function safetyNumber(localIdentityPub: Uint8Array, remoteIdentityPub: Uint8Array): string {
  const [a, b] = [localIdentityPub, remoteIdentityPub].sort((x, y) =>
    sodium.compare(x, y),
  ) as [Uint8Array, Uint8Array];
  const digest = sodium.crypto_generichash(30, new Uint8Array([...a, ...b]), null);
  // Render as 6 groups of 5 digits derived from the hash bytes.
  let out = '';
  for (let i = 0; i < 30; i += 1) {
    out += (digest[i]! % 10).toString();
    if ((i + 1) % 5 === 0 && i !== 29) out += ' ';
  }
  return out;
}
