import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  aeadDecrypt,
  aeadEncrypt,
  bytesToUtf8,
  deriveWrappingKey,
  fromBase64,
  generateKeystoreSalt,
  ready,
  toBase64,
  utf8ToBytes,
} from '@securechat/crypto';
import type { KeystoreSecret } from './cryptoSetup';

/**
 * On-device encrypted storage of the device record.
 *
 * A single wrapping key — Argon2id(password, salt) — protects BOTH the identity
 * secret and the serialized ratchet sessions. The key is held in memory while
 * unlocked (see keyManager) so sessions can be re-wrapped on every change; only
 * ciphertext is ever written to IndexedDB. A stolen device without the password
 * yields nothing.
 */

export interface DeviceRecord {
  username: string;
  deviceId: string;
  registrationId: number;
  salt: string; // base64 — derives the wrapping key
  identityBlob: string; // AEAD(JSON(KeystoreSecret))
  sessionsBlob?: string; // AEAD(JSON(serialized ratchet sessions))
}

interface SecureChatDB extends DBSchema {
  devices: { key: string; value: DeviceRecord };
  // Local encrypted plaintext message log (key = `${username}:${conversationId}`).
  messages: { key: string; value: { id: string; blob: string } };
}

let dbPromise: Promise<IDBPDatabase<SecureChatDB>> | null = null;
export function db(): Promise<IDBPDatabase<SecureChatDB>> {
  dbPromise ??= openDB<SecureChatDB>('securechat', 3, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) database.createObjectStore('devices', { keyPath: 'username' });
      // v1→v2 changed the record shape; old records are replaced on next save.
      if (oldVersion < 3) database.createObjectStore('messages', { keyPath: 'id' });
    },
  });
  return dbPromise;
}

/** Create/replace the device record. Returns the in-memory wrapping key. */
export async function saveDevice(
  username: string,
  deviceId: string,
  registrationId: number,
  secret: KeystoreSecret,
  password: string,
): Promise<Uint8Array> {
  await ready();
  const salt = generateKeystoreSalt();
  const key = deriveWrappingKey(password, salt);
  const identityBlob = toBase64(aeadEncrypt(key, utf8ToBytes(JSON.stringify(secret))));
  await (await db()).put('devices', {
    username,
    deviceId,
    registrationId,
    salt: toBase64(salt),
    identityBlob,
  });
  return key;
}

export async function loadDevice(username: string): Promise<DeviceRecord | undefined> {
  return (await db()).get('devices', username);
}

/** Decrypt the identity secret. Throws on wrong password. Returns secret + key. */
export async function unlockDevice(
  record: DeviceRecord,
  password: string,
): Promise<{ secret: KeystoreSecret; key: Uint8Array }> {
  await ready();
  const key = deriveWrappingKey(password, fromBase64(record.salt));
  const secret = JSON.parse(
    bytesToUtf8(aeadDecrypt(key, fromBase64(record.identityBlob))),
  ) as KeystoreSecret;
  return { secret, key };
}

/** Persist the serialized ratchet sessions (wrapped) onto the device record. */
export async function saveSessions(
  username: string,
  key: Uint8Array,
  sessionsJson: string,
): Promise<void> {
  await ready();
  const rec = await loadDevice(username);
  if (!rec) return;
  rec.sessionsBlob = toBase64(aeadEncrypt(key, utf8ToBytes(sessionsJson)));
  await (await db()).put('devices', rec);
}

/** Decrypt the stored sessions blob, or null if none. */
export function loadSessions(record: DeviceRecord, key: Uint8Array): string | null {
  if (!record.sessionsBlob) return null;
  return bytesToUtf8(aeadDecrypt(key, fromBase64(record.sessionsBlob)));
}

export async function clearDeviceRecord(username: string): Promise<void> {
  await (await db()).delete('devices', username);
}
