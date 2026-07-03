import {
  fromBase64,
  type DeviceIdentity,
  type OneTimePreKey,
  type SignedPreKey,
} from '@securechat/crypto';
import type { KeystoreSecret } from './cryptoSetup';

/**
 * In-memory holder for the unlocked device secret. Populated at register/login
 * (passphrase in hand) or via the unlock flow after a reload. Reconstructs the
 * libsodium key objects from the base64 keystore payload.
 *
 * Nothing here is persisted; the wrapped secret lives in IndexedDB (see keystore).
 */

interface Active {
  userId: string;
  deviceId: string;
  username: string;
  secret: KeystoreSecret;
  identity: DeviceIdentity;
  wrappingKey: Uint8Array; // for re-wrapping ratchet sessions at rest
}

let active: Active | null = null;

function toIdentity(secret: KeystoreSecret): DeviceIdentity {
  return {
    signing: {
      publicKey: fromBase64(secret.signing.publicKey),
      privateKey: fromBase64(secret.signing.privateKey),
    },
    dh: {
      publicKey: fromBase64(secret.dh.publicKey),
      privateKey: fromBase64(secret.dh.privateKey),
    },
  };
}

export function setActive(
  userId: string,
  username: string,
  deviceId: string,
  secret: KeystoreSecret,
  wrappingKey: Uint8Array,
): void {
  active = { userId, username, deviceId, secret, wrappingKey, identity: toIdentity(secret) };
}

export function clearActive(): void {
  active = null;
}

export function isUnlocked(): boolean {
  return active !== null;
}

export function current(): Active {
  if (!active) throw new Error('key manager is locked');
  return active;
}

/** The device's signed prekey reconstructed as libsodium key objects. */
export function signedPreKey(): SignedPreKey {
  const { secret } = current();
  return {
    keyId: secret.signedPreKey.keyId,
    keyPair: {
      publicKey: fromBase64(secret.signedPreKey.publicKey),
      privateKey: fromBase64(secret.signedPreKey.privateKey),
    },
    signature: fromBase64(secret.signedPreKey.signature),
  };
}

/** Look up a one-time prekey (by id) referenced in an inbound X3DH message. */
export function findOneTimePreKey(keyId: number): OneTimePreKey | undefined {
  const { secret } = current();
  const k = secret.oneTimePreKeys.find((x) => x.keyId === keyId);
  if (!k) return undefined;
  return {
    keyId: k.keyId,
    keyPair: { publicKey: fromBase64(k.publicKey), privateKey: fromBase64(k.privateKey) },
  };
}
