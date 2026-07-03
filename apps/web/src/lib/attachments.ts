import { decryptFile, encryptFile, fromBase64, ready } from '@securechat/crypto';
import { api } from './api';
import type { AttachmentMeta } from './content';

/**
 * Attachment transfer. Files are encrypted on the client with a fresh per-file
 * key, the ciphertext is PUT directly to object storage via a presigned URL, and
 * the key travels inside the E2EE message. Downloads reverse this: presigned GET →
 * decrypt locally. The server only ever handles ciphertext.
 */

export interface UploadedAttachment extends AttachmentMeta {
  byteSize: number; // ciphertext size (for the server record)
}

export async function uploadFile(
  file: File,
  override?: Partial<Pick<AttachmentMeta, 'kind' | 'durationMs'>>,
): Promise<UploadedAttachment> {
  await ready();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const enc = encryptFile(bytes);

  const { blobKey, uploadUrl } = await api.presignUpload();
  const put = await fetch(uploadUrl, { method: 'PUT', body: enc.ciphertext });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);

  return {
    kind: file.type.startsWith('image/') ? 'image' : 'file',
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: bytes.length,
    blobKey,
    key: enc.key,
    byteSize: enc.ciphertext.length,
    ...override,
  };
}

/**
 * Upload a profile avatar. Unlike message attachments, avatars are NOT encrypted —
 * they are profile-public (viewable by any contact), consistent with usernames being
 * discoverable. Returns the object-storage blob key to store on the profile.
 */
export async function uploadAvatar(file: File): Promise<string> {
  const { blobKey, uploadUrl } = await api.presignUpload();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const put = await fetch(uploadUrl, { method: 'PUT', body: bytes });
  if (!put.ok) throw new Error(`avatar upload failed (${put.status})`);
  return blobKey;
}

// Cache decrypted blobs as object URLs (keyed by blob key) for the session.
const objectUrlCache = new Map<string, string>();

export async function fetchAttachmentUrl(att: AttachmentMeta): Promise<string> {
  const cached = objectUrlCache.get(att.blobKey);
  if (cached) return cached;

  await ready();
  const { downloadUrl } = await api.attachmentDownload(att.blobKey);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const plaintext = decryptFile(fromBase64(att.key), ciphertext);
  // Copy into a fresh ArrayBuffer so Blob gets a clean, correctly-sized buffer.
  const url = URL.createObjectURL(new Blob([plaintext.slice()], { type: att.mime }));
  objectUrlCache.set(att.blobKey, url);
  return url;
}
