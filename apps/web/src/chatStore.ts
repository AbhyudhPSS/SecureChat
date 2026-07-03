import { create } from 'zustand';
import type { ConversationDetail, ConversationSummary } from '@securechat/types';
import type { AttachmentMeta, ReplyRef } from './lib/content';

/** A message as shown in the UI (decrypted locally; never sent in this form). */
export interface ChatMessage {
  id: string; // server message id (or a temp id while sending)
  conversationId: string;
  senderUserId: string;
  fromMe: boolean;
  text: string;
  attachment?: AttachmentMeta;
  replyTo?: ReplyRef;
  reactions?: string[]; // local-only reactions (per this device)
  createdAt: string;
  state?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  undecryptable?: boolean;
}

const PIN_KEY = 'sc_pinned';
function loadPins(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]');
  } catch {
    return [];
  }
}

interface ChatState {
  conversations: ConversationSummary[];
  details: Record<string, ConversationDetail>; // conversationId -> members/roles
  activeId: string | null;
  messages: Record<string, ChatMessage[]>; // conversationId -> messages (asc)
  typing: Record<string, boolean>; // conversationId -> peer typing
  online: Set<string>; // online userIds
  pinned: Set<string>; // pinned conversation ids (persisted locally)

  togglePin: (id: string) => void;
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => void;
  setConversations: (c: ConversationSummary[]) => void;
  upsertConversation: (c: ConversationSummary) => void;
  removeConversation: (id: string) => void;
  setDetail: (d: ConversationDetail) => void;
  setActive: (id: string | null) => void;
  setMessages: (conversationId: string, messages: ChatMessage[]) => void;
  addMessage: (m: ChatMessage) => void;
  patchMessage: (conversationId: string, id: string, patch: Partial<ChatMessage>) => void;
  setTyping: (conversationId: string, isTyping: boolean) => void;
  setOnline: (userIds: string[]) => void;
  setPresence: (userId: string, online: boolean) => void;
  reset: () => void;
}

export const useChat = create<ChatState>((set) => ({
  conversations: [],
  details: {},
  activeId: null,
  messages: {},
  typing: {},
  online: new Set(),
  pinned: new Set(loadPins()),

  togglePin: (id) =>
    set((s) => {
      const next = new Set(s.pinned);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return { pinned: next };
    }),
  toggleReaction: (conversationId, messageId, emoji) =>
    set((s) => {
      const list = s.messages[conversationId] ?? [];
      return {
        messages: {
          ...s.messages,
          [conversationId]: list.map((m) => {
            if (m.id !== messageId) return m;
            const has = m.reactions?.includes(emoji);
            const reactions = has
              ? m.reactions!.filter((e) => e !== emoji)
              : [...(m.reactions ?? []), emoji];
            return { ...m, reactions };
          }),
        },
      };
    }),
  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (c) =>
    set((s) => {
      const rest = s.conversations.filter((x) => x.id !== c.id);
      return { conversations: [c, ...rest] };
    }),
  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    })),
  setDetail: (d) => set((s) => ({ details: { ...s.details, [d.id]: d } })),
  setActive: (activeId) => set({ activeId }),
  setMessages: (conversationId, messages) =>
    set((s) => ({ messages: { ...s.messages, [conversationId]: messages } })),
  addMessage: (m) =>
    set((s) => {
      const list = s.messages[m.conversationId] ?? [];
      if (list.some((x) => x.id === m.id)) return s; // dedupe
      return { messages: { ...s.messages, [m.conversationId]: [...list, m] } };
    }),
  patchMessage: (conversationId, id, patch) =>
    set((s) => {
      const list = s.messages[conversationId] ?? [];
      return {
        messages: {
          ...s.messages,
          [conversationId]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        },
      };
    }),
  setTyping: (conversationId, isTyping) =>
    set((s) => ({ typing: { ...s.typing, [conversationId]: isTyping } })),
  setOnline: (userIds) => set({ online: new Set(userIds) }),
  setPresence: (userId, online) =>
    set((s) => {
      const next = new Set(s.online);
      if (online) next.add(userId);
      else next.delete(userId);
      return { online: next };
    }),
  reset: () =>
    set({
      conversations: [],
      details: {},
      activeId: null,
      messages: {},
      typing: {},
      online: new Set(),
      pinned: new Set(loadPins()),
    }),
}));
