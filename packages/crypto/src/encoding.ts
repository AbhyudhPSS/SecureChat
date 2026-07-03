import { sodium } from './sodium.js';

/**
 * Encoding helpers. All wire formats in SecureChat use URL-safe base64 (no
 * padding) so keys and ciphertext travel cleanly in JSON and URLs.
 */

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function fromBase64(b64: string): Uint8Array {
  return sodium.from_base64(b64, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function toHex(bytes: Uint8Array): string {
  return sodium.to_hex(bytes);
}

export function fromHex(hex: string): Uint8Array {
  return sodium.from_hex(hex);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8ToBytes(s: string): Uint8Array {
  return encoder.encode(s);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Concatenate a list of byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Constant-time equality, important for comparing MACs / fingerprints. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return sodium.memcmp(a, b);
}
