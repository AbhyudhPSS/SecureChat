import {
  ready,
  generateDeviceIdentity,
  generateSignedPreKey,
  generateOneTimePreKeys,
  toBase64,
} from '@securechat/crypto';
import type { PreKeyBundleUpload } from '@securechat/types';

/**
 * Client-side device key material.
 *
 * `upload` is the PUBLIC bundle sent to the server. `secret` is the full private
 * payload that is wrapped with the user's passphrase and stored in IndexedDB — it
 * never leaves the device unencrypted.
 */

export interface KeystoreSecret {
  signing: { publicKey: string; privateKey: string };
  dh: { publicKey: string; privateKey: string };
  signedPreKey: { keyId: number; publicKey: string; privateKey: string; signature: string };
  oneTimePreKeys: Array<{ keyId: number; publicKey: string; privateKey: string }>;
}

export interface DeviceMaterial {
  registrationId: number;
  upload: PreKeyBundleUpload;
  secret: KeystoreSecret;
}

const ONE_TIME_PREKEY_COUNT = 50;

function randomRegistrationId(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff;
}

/** Generate a fresh device identity + prekeys for this client. */
export async function createDeviceMaterial(deviceName: string): Promise<DeviceMaterial> {
  await ready();
  const identity = generateDeviceIdentity();
  const signedPreKey = generateSignedPreKey(identity, 1);
  const oneTimePreKeys = generateOneTimePreKeys(ONE_TIME_PREKEY_COUNT, 1);
  const registrationId = randomRegistrationId();

  const secret: KeystoreSecret = {
    signing: {
      publicKey: toBase64(identity.signing.publicKey),
      privateKey: toBase64(identity.signing.privateKey),
    },
    dh: {
      publicKey: toBase64(identity.dh.publicKey),
      privateKey: toBase64(identity.dh.privateKey),
    },
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: toBase64(signedPreKey.keyPair.publicKey),
      privateKey: toBase64(signedPreKey.keyPair.privateKey),
      signature: toBase64(signedPreKey.signature),
    },
    oneTimePreKeys: oneTimePreKeys.map((k) => ({
      keyId: k.keyId,
      publicKey: toBase64(k.keyPair.publicKey),
      privateKey: toBase64(k.keyPair.privateKey),
    })),
  };

  return { registrationId, secret, upload: uploadFromSecret(deviceName, registrationId, secret) };
}

/** Rebuild the PUBLIC upload bundle from a decrypted secret (returning device). */
export function uploadFromSecret(
  deviceName: string,
  registrationId: number,
  secret: KeystoreSecret,
): PreKeyBundleUpload {
  return {
    registrationId,
    deviceName,
    signingPublicKey: secret.signing.publicKey,
    identityPublicKey: secret.dh.publicKey,
    signedPreKey: {
      keyId: secret.signedPreKey.keyId,
      publicKey: secret.signedPreKey.publicKey,
      signature: secret.signedPreKey.signature,
    },
    oneTimePreKeys: secret.oneTimePreKeys.map((k) => ({
      keyId: k.keyId,
      publicKey: k.publicKey,
    })),
  };
}
