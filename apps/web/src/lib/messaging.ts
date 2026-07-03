import type {
  AttachmentRef,
  ConversationDetail,
  Envelope,
  MemberRole,
  MessageItem,
  PublicUser,
  WsServerEvent,
} from '@securechat/types';
import { fromBase64, safetyNumber } from '@securechat/crypto';
import { api } from './api';
import * as km from './keyManager';
import * as sessions from './sessions';
import { connectWs, disconnectWs, onServerEvent, sendWs } from './ws';
import { handleCallSignal } from './calls';
import { loadMessages, saveMessages } from './messageStore';
import { decodePayload, encodePayload, type ReplyRef } from './content';
import { uploadFile } from './attachments';
import { playReceived, playSent } from './sounds';
import { useChat, type ChatMessage } from '../chatStore';

/**
 * High-level messaging: turns plaintext ↔ encrypted envelopes and drives the
 * chat store from REST + WebSocket events. All encryption happens here on the
 * client via the session manager; the server only ever sees ciphertext.
 *
 * Direct and group conversations share ONE path: a message is fanned out to every
 * device of every conversation member (except the sending device). Groups use the
 * same pairwise Double Ratchet as 1:1 — there is no shared group key to rotate.
 */

// Cache of conversationId -> target device ids (all members' devices minus mine).
const convoTargets = new Map<string, string[]>();

export function initMessaging(): void {
  onServerEvent(handleServerEvent);
  connectWs();
  void loadConversations();
}

export function teardownMessaging(): void {
  disconnectWs();
  convoTargets.clear();
  peerIdentity.clear();
  sessions.clearSessions();
  useChat.getState().reset();
}

export async function loadConversations(): Promise<void> {
  const convos = await api.listConversations();
  useChat.getState().setConversations(convos);
  // Seed presence for peers (WS only pushes CHANGES; this gives initial state).
  const peerIds = convos.map((c) => c.peer?.id).filter((id): id is string => !!id);
  if (peerIds.length > 0) {
    try {
      const { onlineUserIds } = await api.presence(peerIds);
      useChat.getState().setOnline(onlineUserIds);
    } catch {
      /* presence is best-effort */
    }
  }
}

export async function openConversation(peer: PublicUser): Promise<string> {
  const summary = await api.createConversation(peer.id);
  useChat.getState().upsertConversation(summary);
  useChat.getState().setActive(summary.id);
  try {
    const { onlineUserIds } = await api.presence([peer.id]);
    useChat.getState().setPresence(peer.id, onlineUserIds.includes(peer.id));
  } catch {
    /* best-effort */
  }
  await loadDetail(summary.id);
  await loadHistory(summary.id);
  return summary.id;
}

export async function createGroup(title: string, memberUserIds: string[]): Promise<string> {
  const summary = await api.createGroup(title, memberUserIds);
  useChat.getState().upsertConversation(summary);
  useChat.getState().setActive(summary.id);
  await loadDetail(summary.id);
  await loadHistory(summary.id);
  return summary.id;
}

export async function selectConversation(conversationId: string): Promise<void> {
  useChat.getState().setActive(conversationId);
  await loadDetail(conversationId);
  await loadHistory(conversationId);
}

/** Fetch + cache a conversation's members/roles (drives group UI + fan-out). */
async function loadDetail(conversationId: string): Promise<ConversationDetail | null> {
  try {
    const detail = await api.conversationDetail(conversationId);
    useChat.getState().setDetail(detail);
    return detail;
  } catch {
    return null;
  }
}

// ── Group management ────────────────────────────────────────────────────────────

export async function addMembers(conversationId: string, userIds: string[]): Promise<void> {
  await api.addMembers(conversationId, userIds);
  convoTargets.delete(conversationId); // membership changed → recompute fan-out
  await loadDetail(conversationId);
  await loadConversations();
}

export async function removeMember(conversationId: string, userId: string): Promise<void> {
  await api.removeMember(conversationId, userId);
  convoTargets.delete(conversationId);
  await loadDetail(conversationId);
}

export async function setMemberRole(
  conversationId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await api.setMemberRole(conversationId, userId, role);
  await loadDetail(conversationId);
}

export async function leaveConversation(conversationId: string): Promise<void> {
  await api.removeMember(conversationId, km.current().userId);
  convoTargets.delete(conversationId);
  useChat.getState().removeConversation(conversationId);
}

/**
 * Render a conversation: load the local plaintext log (authoritative — see
 * messageStore), then catch up on any NEW server messages we haven't decrypted
 * yet (offline delivery / fresh device). Already-seen messages are NOT
 * re-decrypted: their keys are gone (forward secrecy), and we already have the
 * plaintext locally.
 */
async function loadHistory(conversationId: string): Promise<void> {
  const me = km.current().userId;
  const local = await loadMessages(conversationId);
  const known = new Set(local.map((m) => m.id));
  const merged = [...local];

  let items: Awaited<ReturnType<typeof api.history>> = [];
  try {
    items = await api.history(conversationId);
  } catch {
    /* offline — local log still renders */
  }
  for (const it of items) {
    if (known.has(it.id)) continue;
    try {
      merged.push(fromDecrypted(it, me, await sessions.decryptFrom(it.senderDeviceId, it.envelope)));
      known.add(it.id);
    } catch {
      /* key already consumed or undecryptable — skip */
    }
  }

  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useChat.getState().setMessages(conversationId, merged);
  await saveMessages(conversationId, merged);
}

async function persistConversation(conversationId: string): Promise<void> {
  const msgs = useChat.getState().messages[conversationId];
  if (msgs) await saveMessages(conversationId, msgs);
}

/** Build a ChatMessage from a decrypted body (text or file payload). */
function fromDecrypted(it: MessageItem, me: string, raw: string): ChatMessage {
  const payload = decodePayload(raw);
  const base = {
    id: it.id,
    conversationId: it.conversationId,
    senderUserId: it.senderUserId,
    fromMe: it.senderUserId === me,
    createdAt: it.createdAt,
    state: 'delivered' as const,
  };
  if (payload.t === 'file') {
    return { ...base, text: payload.caption ?? '', attachment: payload.attachment, replyTo: payload.replyTo };
  }
  return { ...base, text: payload.body, replyTo: payload.replyTo };
}

/** Encrypt an encoded payload to every member device (minus mine) and POST it. */
async function deliver(
  conversationId: string,
  encoded: string,
  attachments?: AttachmentRef[],
): Promise<{ messageId: string; createdAt: string }> {
  const targets = await ensureConversationSessions(conversationId);
  const envelopes: Envelope[] = [];
  for (const deviceId of targets) {
    envelopes.push({ recipientDeviceId: deviceId, ...(await sessions.encryptFor(deviceId, encoded)) });
  }
  return api.sendMessage({
    conversationId,
    senderDeviceId: km.current().deviceId,
    envelopes,
    attachments,
  });
}

/**
 * Ensure a ratchet session to every device of every conversation member, except
 * the sending device. Naturally covers the peer (1:1), all group members, and the
 * sender's own other devices (multi-device sync).
 */
async function ensureConversationSessions(conversationId: string): Promise<string[]> {
  const cached = convoTargets.get(conversationId);
  if (cached && cached.every((d) => sessions.hasSession(d))) return cached;

  const detail =
    useChat.getState().details[conversationId] ?? (await loadDetail(conversationId));
  if (!detail) throw new Error('conversation detail unavailable');

  const myUserId = km.current().userId;
  const myDevice = km.current().deviceId;
  const targets: string[] = [];
  for (const member of detail.members) {
    const bundles = await api.keyBundle(member.user.id);
    for (const d of bundles.devices) {
      if (d.deviceId === myDevice) continue; // never message the sending device
      if (!sessions.hasSession(d.deviceId)) sessions.startSession(d);
      targets.push(d.deviceId);
    }
    if (detail.type === 'DIRECT' && member.user.id !== myUserId && bundles.devices[0]) {
      peerIdentity.set(member.user.id, bundles.devices[0].identityPublicKey);
    }
  }
  convoTargets.set(conversationId, targets);
  return targets;
}

// peerUserId -> their (first device's) X25519 identity key, for safety numbers.
const peerIdentity = new Map<string, string>();

/**
 * Safety number for verifying a peer out-of-band. Computed from both parties'
 * identity keys (BLAKE2b); identical on both sides regardless of ordering.
 */
export async function getSafetyNumber(peerUserId: string): Promise<string | null> {
  let peerKey = peerIdentity.get(peerUserId);
  if (!peerKey) {
    try {
      const r = await api.identity(peerUserId);
      peerKey = r.devices[0]?.identityPublicKey;
      if (peerKey) peerIdentity.set(peerUserId, peerKey);
    } catch {
      return null;
    }
  }
  if (!peerKey) return null;
  return safetyNumber(fromBase64(km.current().secret.dh.publicKey), fromBase64(peerKey));
}

export async function sendText(
  conversationId: string,
  text: string,
  replyTo?: ReplyRef,
): Promise<void> {
  const tempId = optimistic(conversationId, { text, replyTo });
  playSent();
  try {
    const res = await deliver(conversationId, encodePayload({ t: 'text', body: text, replyTo }));
    finalize(conversationId, tempId, res);
  } catch (err) {
    fail(conversationId, tempId);
    throw err;
  }
}

/** Toggle a local reaction on a message and persist it. */
export function reactToMessage(conversationId: string, messageId: string, emoji: string): void {
  useChat.getState().toggleReaction(conversationId, messageId, emoji);
  void persistConversation(conversationId);
}

export async function sendVoice(
  conversationId: string,
  blob: Blob,
  durationMs: number,
): Promise<void> {
  const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
  const uploaded = await uploadFile(file, { kind: 'voice', durationMs });
  const { byteSize, ...attachment } = uploaded;
  const tempId = optimistic(conversationId, { text: '', attachment });
  playSent();
  try {
    const res = await deliver(conversationId, encodePayload({ t: 'file', attachment }), [
      { blobKey: attachment.blobKey, byteSize },
    ]);
    finalize(conversationId, tempId, res);
  } catch (err) {
    fail(conversationId, tempId);
    throw err;
  }
}

export async function sendFile(conversationId: string, file: File): Promise<void> {
  const uploaded = await uploadFile(file); // encrypt + upload before showing optimism
  const { byteSize, ...attachment } = uploaded;
  const tempId = optimistic(conversationId, { text: '', attachment });
  playSent();
  try {
    const res = await deliver(conversationId, encodePayload({ t: 'file', attachment }), [
      { blobKey: attachment.blobKey, byteSize },
    ]);
    finalize(conversationId, tempId, res);
  } catch (err) {
    fail(conversationId, tempId);
    throw err;
  }
}

function optimistic(conversationId: string, fields: Partial<ChatMessage>): string {
  const tempId = `tmp_${Math.random().toString(36).slice(2)}`;
  useChat.getState().addMessage({
    id: tempId,
    conversationId,
    senderUserId: km.current().userId,
    fromMe: true,
    text: '',
    createdAt: new Date().toISOString(),
    state: 'sending',
    ...fields,
  });
  return tempId;
}

function finalize(
  conversationId: string,
  tempId: string,
  res: { messageId: string; createdAt: string },
): void {
  useChat
    .getState()
    .patchMessage(conversationId, tempId, { id: res.messageId, state: 'sent', createdAt: res.createdAt });
  void persistConversation(conversationId);
}

function fail(conversationId: string, tempId: string): void {
  useChat.getState().patchMessage(conversationId, tempId, { state: 'failed' });
  void persistConversation(conversationId);
}

export function sendTyping(conversationId: string, isTyping: boolean): void {
  sendWs({ type: 'typing', conversationId, isTyping });
}

function handleServerEvent(ev: WsServerEvent): void {
  const chat = useChat.getState();
  switch (ev.type) {
    case 'ready':
      chat.setOnline(ev.onlineUserIds);
      break;
    case 'presence':
      chat.setPresence(ev.userId, ev.online);
      break;
    case 'typing':
      chat.setTyping(ev.conversationId, ev.isTyping);
      break;
    case 'receipt': {
      const list = chat.messages[ev.conversationId] ?? [];
      if (list.some((m) => m.id === ev.messageId)) {
        chat.patchMessage(ev.conversationId, ev.messageId, {
          state: ev.state === 'READ' ? 'read' : 'delivered',
        });
        void persistConversation(ev.conversationId);
      }
      break;
    }
    case 'message':
      void receiveMessage(ev.message);
      break;
    case 'call': {
      const convo = chat.conversations.find((c) => c.id === ev.conversationId);
      const fromDetail = chat.details[ev.conversationId]?.members.find(
        (m) => m.user.id === ev.fromUserId,
      )?.user.displayName;
      const peerName = fromDetail ?? convo?.peer?.displayName ?? 'Incoming call';
      handleCallSignal(ev.fromUserId, ev.conversationId, ev.signal, peerName);
      break;
    }
    case 'pong':
      break;
  }
}

async function receiveMessage(m: MessageItem): Promise<void> {
  const chat = useChat.getState();
  const me = km.current().userId;
  let message: ChatMessage;
  try {
    message = fromDecrypted(m, me, await sessions.decryptFrom(m.senderDeviceId, m.envelope));
  } catch {
    message = {
      id: m.id,
      conversationId: m.conversationId,
      senderUserId: m.senderUserId,
      fromMe: m.senderUserId === me,
      text: '🔒 Unable to decrypt',
      createdAt: m.createdAt,
      state: 'delivered',
      undecryptable: true,
    };
  }
  const undecryptable = message.undecryptable === true;
  chat.addMessage(message);
  if (!message.fromMe) playReceived();
  await persistConversation(m.conversationId);
  if (!chat.conversations.some((c) => c.id === m.conversationId)) await loadConversations();
  if (!chat.details[m.conversationId]) await loadDetail(m.conversationId);
  if (chat.activeId === m.conversationId && !undecryptable) {
    sendWs({ type: 'read', conversationId: m.conversationId, messageId: m.id });
  }
}
