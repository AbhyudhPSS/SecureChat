import { create } from 'zustand';

export type CallStatus = 'ringing' | 'connecting' | 'connected';

export interface CallParticipant {
  userId: string;
  name: string;
  stream: MediaStream | null;
}

export interface ActiveCall {
  callId: string;
  conversationId: string;
  media: 'audio' | 'video';
  isGroup: boolean;
  /** The caller (incoming) / primary peer (1:1 outgoing) — used to reply to ringing. */
  peerUserId: string;
  /** Display name of the peer/caller (used on the ringing screen). */
  peerName: string;
  direction: 'incoming' | 'outgoing';
  status: CallStatus;
  micOn: boolean;
  camOn: boolean;
  localStream: MediaStream | null;
  /** Remote participants in a mesh call, keyed by userId. */
  participants: Record<string, CallParticipant>;
}

interface CallStoreState {
  call: ActiveCall | null;
  setCall: (call: ActiveCall) => void;
  patchCall: (patch: Partial<ActiveCall>) => void;
  upsertParticipant: (p: CallParticipant) => void;
  removeParticipant: (userId: string) => void;
  clearCall: () => void;
}

export const useCall = create<CallStoreState>((set) => ({
  call: null,
  setCall: (call) => set({ call }),
  patchCall: (patch) => set((s) => (s.call ? { call: { ...s.call, ...patch } } : s)),
  upsertParticipant: (p) =>
    set((s) =>
      s.call
        ? {
            call: {
              ...s.call,
              participants: { ...s.call.participants, [p.userId]: { ...s.call.participants[p.userId], ...p } },
            },
          }
        : s,
    ),
  removeParticipant: (userId) =>
    set((s) => {
      if (!s.call) return s;
      const next = { ...s.call.participants };
      delete next[userId];
      return { call: { ...s.call, participants: next } };
    }),
  clearCall: () => set({ call: null }),
}));
