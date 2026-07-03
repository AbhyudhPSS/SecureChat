/**
 * Length-hiding padding. Message ciphertext length otherwise leaks the plaintext
 * length to the server (and a network observer). We pad plaintext up to a fixed
 * bucket boundary before encryption, so the server only learns the bucket, not
 * the exact size.
 *
 * Scheme: ISO/IEC 7816-4 — append a 0x80 marker byte then 0x00 padding to the
 * next multiple of BUCKET. A full bucket is always added (even when the input is
 * already a multiple) so the marker is unambiguous.
 */

const BUCKET = 256;

export function pad(data: Uint8Array, bucket = BUCKET): Uint8Array {
  const target = (Math.floor(data.length / bucket) + 1) * bucket;
  const out = new Uint8Array(target);
  out.set(data, 0);
  out[data.length] = 0x80;
  return out;
}

export function unpad(padded: Uint8Array): Uint8Array {
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0x00) i--;
  if (i < 0 || padded[i] !== 0x80) throw new Error('unpad: invalid padding');
  return padded.slice(0, i);
}
