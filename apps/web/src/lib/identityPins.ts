import * as km from './keyManager';
import { loadPins, savePins, type DeviceRecord } from './keystore';

/**
 * Trust-on-first-use (TOFU) pinning of peer *device* identity keys.
 *
 * The first time we see a device's X25519 identity key we PIN it. If a later key
 * fetch for the SAME device returns a DIFFERENT key, that is a red flag — a
 * server-assisted MITM or an identity-key swap — and we surface it instead of
 * silently trusting the new key. (The server also makes a device's identity key
 * immutable, so a legitimate rotation always arrives as a brand-new deviceId and
 * therefore a fresh pin — never a "changed".)
 *
 * Pins are public keys, but their INTEGRITY matters, so they are wrapped to
 * IndexedDB under the same in-memory key as the ratchet sessions rather than kept
 * in plain localStorage.
 */

interface Pin {
  userId: string;
  key: string; // base64 X25519 identity public key
}

const pins = new Map<string, Pin>(); // deviceId -> pinned identity key
const changedUsers = new Set<string>(); // userIds with a detected key change this session

/** Restore pins after unlock (mirrors sessions.loadFromRecord). */
export function loadFromRecord(record: DeviceRecord, key: Uint8Array): void {
  pins.clear();
  changedUsers.clear();
  const json = loadPins(record, key);
  if (!json) return;
  const obj = JSON.parse(json) as Record<string, Pin>;
  for (const [deviceId, pin] of Object.entries(obj)) pins.set(deviceId, pin);
}

async function persist(): Promise<void> {
  const obj: Record<string, Pin> = {};
  for (const [deviceId, pin] of pins) obj[deviceId] = pin;
  const { username, wrappingKey } = km.current();
  await savePins(username, wrappingKey, JSON.stringify(obj));
}

/**
 * Check a freshly-fetched device identity key against its pin.
 *  - 'first'   → never seen this device; pin it now (trusted on first use).
 *  - 'ok'      → matches the pin.
 *  - 'changed' → differs from the pin: DO NOT overwrite; flag the user.
 */
export function verify(userId: string, deviceId: string, identityKey: string): 'first' | 'ok' | 'changed' {
  const existing = pins.get(deviceId);
  if (!existing) {
    pins.set(deviceId, { userId, key: identityKey });
    void persist();
    return 'first';
  }
  if (existing.key === identityKey) return 'ok';
  changedUsers.add(userId);
  return 'changed';
}

/** True if any device of this user presented a changed identity key this session. */
export function hasChanged(userId: string): boolean {
  return changedUsers.has(userId);
}

export function clear(): void {
  pins.clear();
  changedUsers.clear();
}
