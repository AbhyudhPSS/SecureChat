/**
 * Message content format. The ENCRYPTED plaintext (what the ratchet seals) is a
 * JSON-encoded payload so a message can be text or a file reference. The per-file
 * decryption key rides inside the file payload — so it is end-to-end encrypted and
 * never reaches the server.
 */

export interface AttachmentMeta {
  kind: 'image' | 'file' | 'voice';
  name: string;
  mime: string;
  size: number; // plaintext size
  blobKey: string; // object-storage key of the ciphertext blob
  key: string; // per-file decryption key (base64)
  durationMs?: number; // for voice messages
}

/** A lightweight quote of the message being replied to (travels in the payload). */
export interface ReplyRef {
  id: string;
  sender: string; // display name of the original sender
  preview: string; // short text/“📎 Attachment” preview
}

export type MessagePayload =
  | { t: 'text'; body: string; replyTo?: ReplyRef }
  | { t: 'file'; caption?: string; attachment: AttachmentMeta; replyTo?: ReplyRef };

export function encodePayload(payload: MessagePayload): string {
  return JSON.stringify(payload);
}

/**
 * Decode a decrypted message body. Falls back to treating the raw string as text
 * (covers plain-text messages from earlier builds and any non-JSON input).
 */
export function decodePayload(raw: string): MessagePayload {
  try {
    const obj = JSON.parse(raw) as MessagePayload;
    if (obj && (obj.t === 'text' || obj.t === 'file')) return obj;
  } catch {
    /* not JSON — legacy plain text */
  }
  return { t: 'text', body: raw };
}
