import type { PublicUser } from '@securechat/types';
import { api, setAccessToken, silentRefresh } from './api';
import { createDeviceMaterial, uploadFromSecret } from './cryptoSetup';
import { clearDeviceRecord, loadDevice, saveDevice, unlockDevice } from './keystore';
import * as km from './keyManager';
import * as sessions from './sessions';

/**
 * High-level auth orchestration: device key generation, the encrypted on-device
 * keystore, the in-memory key manager, and the API. The account password doubles
 * as the keystore passphrase — one secret unlocks both server auth and local keys.
 * The server only ever receives the password (Argon2id-hashed) and PUBLIC keys.
 */

const deviceName = (): string => `Web · ${navigator.platform || 'browser'}`;

export async function register(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<PublicUser> {
  const material = await createDeviceMaterial(deviceName());
  const result = await api.register({
    username: input.username,
    displayName: input.displayName,
    password: input.password,
    device: material.upload,
  });
  setAccessToken(result.accessToken);
  const key = await saveDevice(
    input.username,
    result.deviceId,
    material.registrationId,
    material.secret,
    input.password,
  );
  km.setActive(result.user.id, input.username, result.deviceId, material.secret, key);
  return result.user;
}

export async function login(input: {
  username: string;
  password: string;
}): Promise<PublicUser> {
  const existing = await loadDevice(input.username);

  if (existing) {
    // Returning device: unlock locally (validates the passphrase), reuse keys,
    // and restore persisted ratchet sessions.
    const { secret, key } = await unlockDevice(existing, input.password);
    const upload = uploadFromSecret(deviceName(), existing.registrationId, secret);
    const result = await api.login({ username: input.username, password: input.password, device: upload });
    setAccessToken(result.accessToken);
    km.setActive(result.user.id, input.username, result.deviceId, secret, key);
    sessions.loadFromRecord(existing, key);
    return result.user;
  }

  // New device on this client: provision fresh keys.
  const material = await createDeviceMaterial(deviceName());
  const result = await api.login({
    username: input.username,
    password: input.password,
    device: material.upload,
  });
  setAccessToken(result.accessToken);
  const key = await saveDevice(
    input.username,
    result.deviceId,
    material.registrationId,
    material.secret,
    input.password,
  );
  km.setActive(result.user.id, input.username, result.deviceId, material.secret, key);
  return result.user;
}

export async function logout(opts?: { username?: string; forgetDevice?: boolean }): Promise<void> {
  await api.logout();
  km.clearActive();
  sessions.clearSessions();
  if (opts?.forgetDevice && opts.username) await clearDeviceRecord(opts.username);
}

/**
 * Silent session restore on load (refresh cookie). Returns the user + whether the
 * local keys are unlocked. After a reload the API session can be restored without
 * the password, but the keys stay LOCKED until the user re-enters their passphrase
 * (see `unlock`).
 */
export async function restoreSession(): Promise<{ user: PublicUser; unlocked: boolean } | null> {
  const refreshed = await silentRefresh();
  if (!refreshed) return null;
  let user: PublicUser = refreshed.user;
  try {
    const me = await api.me();
    user = { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl };
  } catch {
    /* fall back to the refresh payload */
  }
  return { user, unlocked: km.isUnlocked() };
}

/** Unlock local keys after a reload by re-deriving the wrapping key from the password. */
export async function unlock(username: string, password: string): Promise<boolean> {
  const record = await loadDevice(username);
  if (!record) return false;
  try {
    const { secret, key } = await unlockDevice(record, password);
    const me = await api.me();
    km.setActive(me.id, username, record.deviceId, secret, key);
    sessions.loadFromRecord(record, key);
    return true;
  } catch {
    return false;
  }
}

export function hasLocalDevice(username: string): Promise<boolean> {
  return loadDevice(username).then((r) => r !== undefined);
}
