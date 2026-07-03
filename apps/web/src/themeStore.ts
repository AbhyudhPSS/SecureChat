import { create } from 'zustand';

/**
 * Theme system — each theme pairs a full-bleed background image with a coordinated
 * accent palette. The actual colors/backgrounds live as CSS variables in index.css
 * (keyed by `[data-theme="…"]`); this store just tracks the selection, persists it,
 * and toggles the `data-theme` attribute on <html>.
 */
export type ThemeId =
  | 'glacier'
  | 'emerald'
  | 'carnival'
  | 'onyx'
  | 'crimson'
  | 'spider'
  | 'bumblebee'
  | 'sunset';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  tagline: string;
  /** Accent swatch shown in the picker (primary, secondary, tertiary). */
  swatch: [string, string, string];
}

export const THEMES: ThemeMeta[] = [
  { id: 'glacier', label: 'Glacier', tagline: 'Cool blue marble', swatch: ['#3b82f6', '#6366f1', '#22d3ee'] },
  { id: 'emerald', label: 'Emerald', tagline: 'Deep green & sand', swatch: ['#10b981', '#eab308', '#a3e635'] },
  { id: 'carnival', label: 'Carnival', tagline: 'Bold pop swirl', swatch: ['#f97316', '#ef4444', '#facc15'] },
  { id: 'onyx', label: 'Amethyst', tagline: 'Violet topography', swatch: ['#a855f7', '#6366f1', '#e879f9'] },
  { id: 'crimson', label: 'Crimson', tagline: 'Racing red', swatch: ['#ef4444', '#f97316', '#f59e0b'] },
  { id: 'spider', label: 'Spider', tagline: 'Crimson web', swatch: ['#ef4444', '#991b1b', '#f87171'] },
  { id: 'bumblebee', label: 'Bumblebee', tagline: 'Pink & honey', swatch: ['#ec4899', '#f59e0b', '#facc15'] },
  { id: 'sunset', label: 'Sunset', tagline: 'Neon peaks', swatch: ['#f43f5e', '#a855f7', '#fb7185'] },
];

const KEY = 'sc_theme';
const OPACITY_KEY = 'sc_glass';
const DEFAULT: ThemeId = 'glacier';
const DEFAULT_OPACITY = 0.4;
/** How translucent the glass panels are. Min 0 = fully clear (blur only, no tint). */
export const OPACITY_MIN = 0;
export const OPACITY_MAX = 0.85;

function load(): ThemeId {
  try {
    const v = localStorage.getItem(KEY) as ThemeId | null;
    if (v && THEMES.some((t) => t.id === v)) return v;
  } catch {
    /* no storage */
  }
  return DEFAULT;
}

function loadOpacity(): number {
  try {
    const v = parseFloat(localStorage.getItem(OPACITY_KEY) ?? '');
    if (!Number.isNaN(v)) return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v));
  } catch {
    /* no storage */
  }
  return DEFAULT_OPACITY;
}

export function applyTheme(id: ThemeId): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = id;
}

/**
 * Drives the glass CSS variables. `--glass` is the panel tint alpha; `--glass-blur`
 * is the frost amount — both scale with the slider so at minimum (0) the panels are
 * fully clear AND unblurred, showing the exact background.
 */
export function applyGlassOpacity(v: number): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--glass', String(v));
  root.style.setProperty('--glass-blur', `${Math.round(v * 40)}px`);
}

interface ThemeState {
  theme: ThemeId;
  glassOpacity: number;
  setTheme: (id: ThemeId) => void;
  setGlassOpacity: (v: number) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: load(),
  glassOpacity: loadOpacity(),
  setTheme: (id) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
    applyTheme(id);
    set({ theme: id });
  },
  setGlassOpacity: (v) => {
    const clamped = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v));
    try {
      localStorage.setItem(OPACITY_KEY, String(clamped));
    } catch {
      /* ignore */
    }
    applyGlassOpacity(clamped);
    set({ glassOpacity: clamped });
  },
}));

// Apply the persisted theme + glass opacity as soon as this module is imported (before
// first paint once imported from main.tsx), so there's no flash of the defaults.
applyTheme(load());
applyGlassOpacity(loadOpacity());
