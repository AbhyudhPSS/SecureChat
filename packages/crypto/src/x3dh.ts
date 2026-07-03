import { sodium } from './sodium.js';
import { concatBytes, fromBase64, toBase64 } from './encoding.js';
import { hkdf } from './kdf.js';
import type {
  DeviceIdentity,
  OneTimePreKey,
  PublicPreKeyBundle,
  SignedPreKey,
} from './identity.js';
import { verifyBundleSignature } from './identity.js';

/**
 * X3DH (Extended Triple Diffie-Hellman) key agreement.
 *
 * Lets an initiator derive a shared secret with a recipient who is OFFLINE, by
 * combining four (or three, without a one-time prekey) Diffie-Hellman outputs.
 * The resulting shared secret seeds the Double Ratchet.
 *
 * Reference: https://signal.org/docs/specifications/x3dh/
 */

const X3DH_INFO = 'SecureChat_X3DH_v1';
// Domain-separation prefix recommended by the X3DH spec for X25519 (32 * 0xFF).
const KDF_PREFIX = new Uint8Array(32).fill(0xff);

function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult(privateKey, publicKey);
}

function deriveSecret(dhConcat: Uint8Array): Uint8Array {
  const ikm = concatBytes(KDF_PREFIX, dhConcat);
  const salt = new Uint8Array(32); // all-zero salt per spec
  return hkdf(ikm, salt, X3DH_INFO, 32);
}

/** Header the initiator must transmit so the responder can reconstruct the secret. */
export interface X3DHInitialMessage {
  initiatorIdentityKey: string; // X25519 public (base64)
  initiatorEphemeralKey: string; // X25519 public (base64)
  signedPreKeyId: number;
  oneTimePreKeyId?: number;
}

export interface X3DHInitiatorResult {
  sharedSecret: Uint8Array;
  message: X3DHInitialMessage;
  /** The responder's identity DH public key — becomes the ratchet's initial remote key. */
  responderIdentityKey: Uint8Array;
  responderSignedPreKey: Uint8Array;
}

/**
 * Initiator side. `bundle` is the recipient's fetched prekey bundle. Throws if
 * the bundle signature does not verify (possible MITM).
 */
export function x3dhInitiate(
  identity: DeviceIdentity,
  bundle: PublicPreKeyBundle,
): X3DHInitiatorResult {
  if (!verifyBundleSignature(bundle)) {
    throw new Error('x3dhInitiate: prekey bundle signature verification failed');
  }

  const ephemeral = sodium.crypto_box_keypair();

  const IK_B = fromBase64(bundle.identityPublicKey);
  const SPK_B = fromBase64(bundle.signedPreKey.publicKey);
  const OPK_B = bundle.oneTimePreKey ? fromBase64(bundle.oneTimePreKey.publicKey) : undefined;

  const dh1 = dh(identity.dh.privateKey, SPK_B);
  const dh2 = dh(ephemeral.privateKey, IK_B);
  const dh3 = dh(ephemeral.privateKey, SPK_B);
  const parts = [dh1, dh2, dh3];
  if (OPK_B) parts.push(dh(ephemeral.privateKey, OPK_B));

  const sharedSecret = deriveSecret(concatBytes(...parts));

  return {
    sharedSecret,
    message: {
      initiatorIdentityKey: toBase64(identity.dh.publicKey),
      initiatorEphemeralKey: toBase64(ephemeral.publicKey),
      signedPreKeyId: bundle.signedPreKey.keyId,
      oneTimePreKeyId: bundle.oneTimePreKey?.keyId,
    },
    responderIdentityKey: IK_B,
    responderSignedPreKey: SPK_B,
  };
}

/**
 * Responder side. Reconstructs the same shared secret using the private halves
 * of the prekeys the initiator referenced. `oneTimePreKey` must be provided iff
 * the initial message referenced one (and must then be deleted after use).
 */
export function x3dhRespond(
  identity: DeviceIdentity,
  signedPreKey: SignedPreKey,
  message: X3DHInitialMessage,
  oneTimePreKey?: OneTimePreKey,
): Uint8Array {
  const IK_A = fromBase64(message.initiatorIdentityKey);
  const EK_A = fromBase64(message.initiatorEphemeralKey);

  const dh1 = dh(signedPreKey.keyPair.privateKey, IK_A);
  const dh2 = dh(identity.dh.privateKey, EK_A);
  const dh3 = dh(signedPreKey.keyPair.privateKey, EK_A);
  const parts = [dh1, dh2, dh3];
  if (message.oneTimePreKeyId !== undefined) {
    if (!oneTimePreKey) {
      throw new Error('x3dhRespond: message references a one-time prekey but none was provided');
    }
    parts.push(dh(oneTimePreKey.keyPair.privateKey, EK_A));
  }

  return deriveSecret(concatBytes(...parts));
}
