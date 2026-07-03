import { create } from 'zustand';
import type { PublicUser } from '@securechat/types';

/**
 * Client session store. `status` drives the top-level view: a brief `loading`
 * while we attempt silent session restore, then `unauthed` (auth screen) or
 * `authed` (chat shell).
 */
type Status = 'loading' | 'unauthed' | 'authed';

interface SessionState {
  status: Status;
  user: PublicUser | null;
  /** Authed via cookie but local E2EE keys not yet unlocked (post-reload). */
  locked: boolean;
  settingsOpen: boolean;
  setAuthed: (user: PublicUser) => void;
  setLocked: (locked: boolean) => void;
  setUnauthed: () => void;
  setUser: (user: PublicUser) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  locked: false,
  settingsOpen: false,
  setAuthed: (user) => set({ status: 'authed', user }),
  setLocked: (locked) => set({ locked }),
  setUnauthed: () => set({ status: 'unauthed', user: null, locked: false, settingsOpen: false }),
  setUser: (user) => set({ user }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
