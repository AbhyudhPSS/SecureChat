/**
 * Voice recording via MediaRecorder. The recorded audio is treated as a normal
 * encrypted attachment (per-file key, uploaded as ciphertext) — it just carries a
 * `voice` kind + duration so the UI renders a player instead of a file chip.
 */

export interface RecordingHandle {
  stop: () => Promise<{ blob: Blob; durationMs: number }>;
  cancel: () => void;
}

export async function startRecording(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const startedAt = performance.now();
  recorder.start();

  const releaseMic = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          releaseMic();
          resolve({
            blob: new Blob(chunks, { type: mimeType }),
            durationMs: Math.round(performance.now() - startedAt),
          });
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = () => releaseMic();
      recorder.stop();
    },
  };
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
