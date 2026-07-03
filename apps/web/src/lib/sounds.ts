import { useSounds } from '../soundStore';

/**
 * Tiny synthesized sound engine — all tones are generated with the Web Audio API
 * (oscillator + gain envelopes), so there are NO audio files to bundle. Tasteful,
 * short, low-volume cues; gated by the user's sound settings.
 */

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  at?: number; // start offset (seconds from now)
}

function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  const ac = audio();
  if (!ac) return;
  const { type = 'sine', gain = 0.06, attack = 0.008, release = 0.12, at = 0 } = opts;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + release + 0.02);
}

const on = (key: 'messages' | 'typing' | 'calls'): boolean => {
  const s = useSounds.getState();
  return s.enabled && s[key];
};

// ── Message cues ──────────────────────────────────────────────────────────────
export function playSent(): void {
  if (!on('messages')) return;
  tone(523.25, 0.07, { type: 'triangle', gain: 0.05 });
  tone(783.99, 0.09, { type: 'triangle', gain: 0.05, at: 0.06 });
}

export function playReceived(): void {
  if (!on('messages')) return;
  tone(659.25, 0.08, { type: 'sine', gain: 0.06 });
  tone(987.77, 0.12, { type: 'sine', gain: 0.05, at: 0.08 });
}

export function playTypingTick(): void {
  if (!on('typing')) return;
  tone(1200, 0.02, { type: 'square', gain: 0.015, release: 0.03 });
}

// ── Call tones (continuous ring) ────────────────────────────────────────────────
let ringTimer: ReturnType<typeof setInterval> | undefined;
// Track the ring's live oscillators so the ring cuts cleanly the instant a call is
// answered/ended (otherwise scheduled tone tails would keep sounding after pickup).
let ringNodes: { osc: OscillatorNode; g: GainNode }[] = [];

/** A sustained ring segment (longer than `tone`, with a flat body so rings feel continuous). */
function ringTone(freq: number, dur: number, opts: { gain?: number; at?: number; type?: OscillatorType } = {}): void {
  const ac = audio();
  if (!ac) return;
  const { gain = 0.05, at = 0, type = 'sine' } = opts;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.04);
  g.gain.setValueAtTime(gain, t0 + Math.max(0.05, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.04);
  const node = { osc, g };
  ringNodes.push(node);
  osc.onended = () => {
    ringNodes = ringNodes.filter((n) => n !== node);
  };
}

/** Incoming-call ringtone: a continuous, insistent two-tone ring (≈1.8s on, ≈0.2s off). */
export function startRingtone(): void {
  if (!on('calls') || ringTimer) return;
  const pattern = () => {
    ringTone(660, 1.8, { gain: 0.06 });
    ringTone(550, 1.8, { gain: 0.05 });
  };
  pattern();
  ringTimer = setInterval(pattern, 2000);
}

/** Outgoing-call ringback: a continuous two-tone warble (≈1.8s on, ≈0.2s off). */
export function startOutgoingTone(): void {
  if (!on('calls') || ringTimer) return;
  const pattern = () => {
    ringTone(440, 1.8, { gain: 0.045 });
    ringTone(480, 1.8, { gain: 0.045 });
  };
  pattern();
  ringTimer = setInterval(pattern, 2000);
}

/** Stop the ring immediately (on answer, connect, or hang-up) — fade out live nodes fast. */
export function stopCallTone(): void {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = undefined;
  }
  const ac = audio();
  if (ac) {
    const now = ac.currentTime;
    for (const { osc, g } of ringNodes) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        osc.stop(now + 0.08);
      } catch {
        /* node already stopped */
      }
    }
  }
  ringNodes = [];
}

/** Call connected: a short confirming rise. */
export function playConnected(): void {
  if (!on('calls')) return;
  tone(523.25, 0.1, { gain: 0.05 });
  tone(659.25, 0.1, { gain: 0.05, at: 0.09 });
  tone(880, 0.14, { gain: 0.05, at: 0.18 });
}
