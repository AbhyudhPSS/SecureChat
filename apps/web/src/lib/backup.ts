import { decryptKeystore, encryptKeystore, type WrappedKeystore } from '@securechat/crypto';
import * as km from './keyManager';
import * as sessions from './sessions';
import { exportAll, saveMessages } from './messageStore';
import { api } from './api';
import type { ChatMessage } from '../chatStore';
import type { KeystoreSecret } from './cryptoSetup';

/**
 * Encrypted chat backup. The bundle (identity keys, ratchet sessions, and the
 * decrypted message log) is wrapped with a user-chosen passphrase via Argon2id and
 * is OPAQUE to the server — it can be stored server-side or downloaded as a file.
 * Restoring needs both the account session AND the backup passphrase.
 */

interface BackupBundle {
  v: 1;
  username: string;
  userId: string;
  deviceId: string;
  secret: KeystoreSecret;
  sessions: string;
  messages: Record<string, ChatMessage[]>;
  createdAt: string;
}

/** Build the passphrase-encrypted backup blob (a JSON-stringified WrappedKeystore). */
export async function buildBackup(passphrase: string): Promise<string> {
  const cur = km.current();
  const bundle: BackupBundle = {
    v: 1,
    username: cur.username,
    userId: cur.userId,
    deviceId: cur.deviceId,
    secret: cur.secret,
    sessions: sessions.exportSerialized(),
    messages: await exportAll(),
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(encryptKeystore(passphrase, bundle));
}

export async function backupToServer(passphrase: string): Promise<void> {
  await api.uploadBackup(await buildBackup(passphrase));
}

export function downloadBackupFile(blob: string): void {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `securechat-backup-${new Date().toISOString().slice(0, 10)}.scbackup`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface RestoreResult {
  conversations: number;
  messages: number;
}

/** Decrypt + restore a backup blob into local storage. Throws on wrong passphrase. */
export async function restoreFromString(passphrase: string, blobStr: string): Promise<RestoreResult> {
  const wrapped = JSON.parse(blobStr) as WrappedKeystore;
  const bundle = decryptKeystore<BackupBundle>(passphrase, wrapped); // throws if wrong
  let messages = 0;
  for (const [conversationId, msgs] of Object.entries(bundle.messages)) {
    await saveMessages(conversationId, msgs); // re-wrapped with the current device key
    messages += msgs.length;
  }
  if (bundle.sessions) sessions.importSerialized(bundle.sessions);
  return { conversations: Object.keys(bundle.messages).length, messages };
}

export async function restoreFromServer(passphrase: string): Promise<RestoreResult> {
  const { blob } = await api.downloadBackup();
  return restoreFromString(passphrase, blob);
}
