import { create } from 'zustand';

/** User sound preferences, persisted to localStorage. Read by the sound engine. */
export interface SoundSettings {
  enabled: boolean; // master switch
  messages: boolean; // sent/received chimes
  typing: boolean; // subtle typing tick
  calls: boolean; // ringtone / outgoing tone
}

const KEY = 'sc_sounds';
const DEFAULTS: SoundSettings = { enabled: true, messages: true, typing: false, calls: true };

function load(): SoundSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

interface SoundStore extends SoundSettings {
  set: (patch: Partial<SoundSettings>) => void;
}

export const useSounds = create<SoundStore>((set) => ({
  ...load(),
  set: (patch) =>
    set((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ enabled: next.enabled, messages: next.messages, typing: next.typing, calls: next.calls }),
        );
      } catch {
        /* ignore */
      }
      return next;
    }),
}));
