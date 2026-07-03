import {
  bytesToUtf8,
  deserializeState,
  initRatchetInitiator,
  initRatchetResponder,
  pad,
  ratchetDecrypt,
  ratchetEncrypt,
  serializeState,
  unpad,
  utf8ToBytes,
  x3dhInitiate,
  x3dhRespond,
  type PublicPreKeyBundle,
  type RatchetState,
} from '@securechat/crypto';
import type { DeviceBundle, X3dhInit } from '@securechat/types';
import * as km from './keyManager';
import { loadSessions, saveSessions, type DeviceRecord } from './keystore';

/**
 * Per-peer-device Double Ratchet sessions. Each pair (myDevice ↔ peerDevice) has
 * its own ratchet. Sessions are kept in memory and re-wrapped to IndexedDB on
 * every change so conversations survive a reload (after unlock).
 */

const sessions = new Map<string, RatchetState>(); // peerDeviceId -> ratchet state
const pendingInit = new Map<string, X3dhInit>(); // peerDeviceId -> X3DH init for the FIRST message

export interface OutboundEnvelope {
  x3dh?: X3dhInit;
  header: { dh: string; pn: number; n: number };
  ciphertext: string;
}

export function hasSession(peerDeviceId: string): boolean {
  return sessions.has(peerDeviceId);
}

/** Restore persisted sessions after unlock. */
export function loadFromRecord(record: DeviceRecord, key: Uint8Array): void {
  const json = loadSessions(record, key);
  if (!json) return;
  const obj = JSON.parse(json) as Record<string, string>;
  for (const [peerDeviceId, serialized] of Object.entries(obj)) {
    sessions.set(peerDeviceId, deserializeState(serialized));
  }
}

async function persist(): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [peerDeviceId, state] of sessions) obj[peerDeviceId] = serializeState(state);
  const { username, wrappingKey } = km.current();
  await saveSessions(username, wrappingKey, JSON.stringify(obj));
}

/** Open a new outbound session from a peer device's fetched bundle (X3DH initiator). */
export function startSession(deviceBundle: DeviceBundle): void {
  const bundle: PublicPreKeyBundle = {
    signingPublicKey: deviceBundle.signingPublicKey,
    identityPublicKey: deviceBundle.identityPublicKey,
    signedPreKey: deviceBundle.signedPreKey,
    oneTimePreKey: deviceBundle.oneTimePreKey,
  };
  const init = x3dhInitiate(km.current().identity, bundle); // verifies bundle signature
  sessions.set(deviceBundle.deviceId, initRatchetInitiator(init.sharedSecret, init.responderSignedPreKey));
  pendingInit.set(deviceBundle.deviceId, init.message);
}

/** Encrypt plaintext for a peer device (session must exist). */
export async function encryptFor(peerDeviceId: string, plaintext: string): Promise<OutboundEnvelope> {
  const state = sessions.get(peerDeviceId);
  if (!state) throw new Error(`no session for device ${peerDeviceId}`);
  // Pad to a fixed bucket so ciphertext length doesn't leak the message length.
  const msg = ratchetEncrypt(state, pad(utf8ToBytes(plaintext)));
  const x3dh = pendingInit.get(peerDeviceId);
  pendingInit.delete(peerDeviceId); // X3DH init rides only the first message
  await persist();
  return { x3dh, header: msg.header, ciphertext: msg.body };
}

/** Decrypt an inbound envelope, establishing the session from X3DH if needed. */
export async function decryptFrom(
  senderDeviceId: string,
  envelope: { x3dh?: X3dhInit; header: { dh: string; pn: number; n: number }; ciphertext: string },
): Promise<string> {
  let state = sessions.get(senderDeviceId);
  if (!state) {
    if (!envelope.x3dh) throw new Error('no session and no X3DH init in message');
    const spk = km.signedPreKey();
    const otk =
      envelope.x3dh.oneTimePreKeyId !== undefined
        ? km.findOneTimePreKey(envelope.x3dh.oneTimePreKeyId)
        : undefined;
    const sharedSecret = x3dhRespond(km.current().identity, spk, envelope.x3dh, otk);
    state = initRatchetResponder(sharedSecret, spk.keyPair);
    sessions.set(senderDeviceId, state);
  }
  const plaintext = bytesToUtf8(
    unpad(ratchetDecrypt(state, { header: envelope.header, body: envelope.ciphertext })),
  );
  await persist();
  return plaintext;
}

export function clearSessions(): void {
  sessions.clear();
  pendingInit.clear();
}

/** Serialize all ratchet sessions (for inclusion in an encrypted backup). */
export function exportSerialized(): string {
  const obj: Record<string, string> = {};
  for (const [peerDeviceId, state] of sessions) obj[peerDeviceId] = serializeState(state);
  return JSON.stringify(obj);
}

/** Restore ratchet sessions from a backup, then persist them at rest. */
export function importSerialized(json: string): void {
  const obj = JSON.parse(json) as Record<string, string>;
  for (const [peerDeviceId, serialized] of Object.entries(obj)) {
    sessions.set(peerDeviceId, deserializeState(serialized));
  }
  void persist();
}
