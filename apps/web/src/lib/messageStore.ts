import { aeadDecrypt, aeadEncrypt, bytesToUtf8, fromBase64, toBase64, utf8ToBytes } from '@securechat/crypto';
import * as km from './keyManager';
import { db } from './keystore';
import type { ChatMessage } from '../chatStore';

/**
 * Local plaintext message log, encrypted at rest with the device wrapping key.
 *
 * Why this exists: the Double Ratchet consumes a message key on first decrypt
 * (forward secrecy), so server-stored ciphertext CANNOT be re-decrypted later.
 * The authoritative copy of decrypted conversation history therefore lives here,
 * on the device — exactly as in Signal. The server's job is delivery, not history.
 */

const recordId = (conversationId: string): string => `${km.current().username}:${conversationId}`;

export async function saveMessages(
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  const key = km.current().wrappingKey;
  const blob = toBase64(aeadEncrypt(key, utf8ToBytes(JSON.stringify(messages))));
  await (await db()).put('messages', { id: recordId(conversationId), blob });
}

export async function loadMessages(conversationId: string): Promise<ChatMessage[]> {
  const rec = await (await db()).get('messages', recordId(conversationId));
  if (!rec) return [];
  try {
    return JSON.parse(bytesToUtf8(aeadDecrypt(km.current().wrappingKey, fromBase64(rec.blob)))) as ChatMessage[];
  } catch {
    return [];
  }
}

/** Decrypt EVERY locally-stored conversation log (for an encrypted backup export). */
export async function exportAll(): Promise<Record<string, ChatMessage[]>> {
  const prefix = `${km.current().username}:`;
  const key = km.current().wrappingKey;
  const rows = await (await db()).getAll('messages');
  const out: Record<string, ChatMessage[]> = {};
  for (const row of rows) {
    if (!row.id.startsWith(prefix)) continue;
    const conversationId = row.id.slice(prefix.length);
    try {
      out[conversationId] = JSON.parse(
        bytesToUtf8(aeadDecrypt(key, fromBase64(row.blob))),
      ) as ChatMessage[];
    } catch {
      /* skip undecryptable rows */
    }
  }
  return out;
}

export interface MessageSearchHit {
  conversationId: string;
  message: ChatMessage;
}

/**
 * Full-text search across ALL locally-stored conversations. Runs entirely on the
 * device against decrypted plaintext — the server never sees the query or the
 * content. This is what makes search possible at all under E2EE.
 */
export async function searchMessages(query: string): Promise<MessageSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const prefix = `${km.current().username}:`;
  const key = km.current().wrappingKey;
  const rows = await (await db()).getAll('messages');
  const hits: MessageSearchHit[] = [];
  for (const row of rows) {
    if (!row.id.startsWith(prefix)) continue;
    const conversationId = row.id.slice(prefix.length);
    let messages: ChatMessage[];
    try {
      messages = JSON.parse(bytesToUtf8(aeadDecrypt(key, fromBase64(row.blob)))) as ChatMessage[];
    } catch {
      continue;
    }
    for (const m of messages) {
      const haystack = `${m.text} ${m.attachment?.name ?? ''}`.toLowerCase();
      if (haystack.includes(q)) hits.push({ conversationId, message: m });
    }
  }
  return hits.slice(0, 50);
}
