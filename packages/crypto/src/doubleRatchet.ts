import { sodium } from './sodium.js';
import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { concatBytes, fromBase64, toBase64 } from './encoding.js';
import { hkdf } from './kdf.js';
import type { RawKeyPair } from './identity.js';

/**
 * Double Ratchet (Signal). Provides forward secrecy (a compromised message key
 * cannot decrypt past messages) and post-compromise security / "self-healing"
 * (a compromised session recovers once a fresh DH ratchet step happens).
 *
 * Reference: https://signal.org/docs/specifications/doubleratchet/
 *
 * State holds private keys; it MUST be persisted encrypted at rest on the device
 * (see docs/CRYPTO.md "Local key storage").
 */

const MAX_SKIP = 1000; // hard cap on skipped message keys, prevents DoS
const RK_INFO = 'SecureChat_DR_RootKey_v1';

export interface MessageHeader {
  /** Sender's current ratchet public key (base64). */
  dh: string;
  /** Number of messages in the previous sending chain. */
  pn: number;
  /** Message number within the current sending chain. */
  n: number;
}

export interface RatchetMessage {
  header: MessageHeader;
  /** nonce || ciphertext || tag (base64). */
  body: string;
}

export interface RatchetState {
  dhs: RawKeyPair; // our current ratchet key pair
  dhr: Uint8Array | null; // remote ratchet public key
  rk: Uint8Array; // root key
  cks: Uint8Array | null; // sending chain key
  ckr: Uint8Array | null; // receiving chain key
  ns: number; // sending message counter
  nr: number; // receiving message counter
  pn: number; // previous sending chain length
  skipped: Map<string, Uint8Array>; // (dhrB64:n) -> message key
}

function dh(pair: RawKeyPair, pub: Uint8Array): Uint8Array {
  return sodium.crypto_scalarmult(pair.privateKey, pub);
}

function generateDH(): RawKeyPair {
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Root-key KDF: advances the root key and yields a new chain key. */
function kdfRK(rk: Uint8Array, dhOut: Uint8Array): { rk: Uint8Array; ck: Uint8Array } {
  const out = hkdf(dhOut, rk, RK_INFO, 64);
  return { rk: out.slice(0, 32), ck: out.slice(32, 64) };
}

/** Chain-key KDF: derives a message key and advances the chain key. */
function kdfCK(ck: Uint8Array): { ck: Uint8Array; mk: Uint8Array } {
  const mk = sodium.crypto_auth_hmacsha256(Uint8Array.of(0x01), ck);
  const nextCk = sodium.crypto_auth_hmacsha256(Uint8Array.of(0x02), ck);
  return { ck: nextCk, mk };
}

function encodeHeader(h: MessageHeader): Uint8Array {
  const pn = new Uint8Array(4);
  const n = new Uint8Array(4);
  new DataView(pn.buffer).setUint32(0, h.pn, false);
  new DataView(n.buffer).setUint32(0, h.n, false);
  return concatBytes(fromBase64(h.dh), pn, n);
}

function associated(ad: Uint8Array, h: MessageHeader): Uint8Array {
  return concatBytes(ad, encodeHeader(h));
}

/**
 * Initialize the ratchet for the X3DH INITIATOR (Alice). `remoteDhPublic` is the
 * recipient's signed-prekey public, which doubles as their initial ratchet key.
 */
export function initRatchetInitiator(
  sharedSecret: Uint8Array,
  remoteDhPublic: Uint8Array,
): RatchetState {
  const dhs = generateDH();
  const { rk, ck } = kdfRK(sharedSecret, dh(dhs, remoteDhPublic));
  return {
    dhs,
    dhr: remoteDhPublic,
    rk,
    cks: ck,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

/**
 * Initialize the ratchet for the X3DH RESPONDER (Bob). `dhKeyPair` is Bob's
 * signed-prekey key pair (the key Alice used as the initial remote ratchet key).
 */
export function initRatchetResponder(
  sharedSecret: Uint8Array,
  dhKeyPair: RawKeyPair,
): RatchetState {
  return {
    dhs: dhKeyPair,
    dhr: null,
    rk: sharedSecret,
    cks: null,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: new Map(),
  };
}

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
  ad: Uint8Array = new Uint8Array(0),
): RatchetMessage {
  if (!state.cks) throw new Error('ratchetEncrypt: no sending chain (cannot send yet)');
  const { ck, mk } = kdfCK(state.cks);
  state.cks = ck;
  const header: MessageHeader = { dh: toBase64(state.dhs.publicKey), pn: state.pn, n: state.ns };
  state.ns += 1;
  const body = aeadEncrypt(mk, plaintext, associated(ad, header));
  return { header, body: toBase64(body) };
}

export function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage,
  ad: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const { header } = message;
  const body = fromBase64(message.body);

  // 1) Was this a previously-skipped message key?
  const skippedKey = `${header.dh}:${header.n}`;
  const skippedMk = state.skipped.get(skippedKey);
  if (skippedMk) {
    state.skipped.delete(skippedKey);
    return aeadDecrypt(skippedMk, body, associated(ad, header));
  }

  // 2) New ratchet public key from the peer → perform a DH ratchet step.
  const headerDh = fromBase64(header.dh);
  if (!state.dhr || !sodium.memcmp(headerDh, state.dhr)) {
    skipMessageKeys(state, header.pn);
    dhRatchet(state, headerDh);
  }

  // 3) Skip ahead within the current receiving chain if needed.
  skipMessageKeys(state, header.n);

  if (!state.ckr) throw new Error('ratchetDecrypt: no receiving chain');
  const { ck, mk } = kdfCK(state.ckr);
  state.ckr = ck;
  state.nr += 1;
  return aeadDecrypt(mk, body, associated(ad, header));
}

function skipMessageKeys(state: RatchetState, until: number): void {
  if (!state.ckr) return;
  if (state.nr + MAX_SKIP < until) {
    throw new Error('ratchetDecrypt: too many skipped messages');
  }
  while (state.nr < until) {
    const { ck, mk } = kdfCK(state.ckr);
    state.ckr = ck;
    const dhrB64 = state.dhr ? toBase64(state.dhr) : '';
    state.skipped.set(`${dhrB64}:${state.nr}`, mk);
    state.nr += 1;
  }
}

function dhRatchet(state: RatchetState, headerDh: Uint8Array): void {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhr = headerDh;
  ({ rk: state.rk, ck: state.ckr } = kdfRK(state.rk, dh(state.dhs, headerDh)));
  state.dhs = generateDH();
  ({ rk: state.rk, ck: state.cks } = kdfRK(state.rk, dh(state.dhs, headerDh)));
}

// ── Persistence ──────────────────────────────────────────────────────────────
// Serialize ratchet state (incl. private keys) for encrypted-at-rest storage.

export function serializeState(state: RatchetState): string {
  return JSON.stringify({
    dhs: { publicKey: toBase64(state.dhs.publicKey), privateKey: toBase64(state.dhs.privateKey) },
    dhr: state.dhr ? toBase64(state.dhr) : null,
    rk: toBase64(state.rk),
    cks: state.cks ? toBase64(state.cks) : null,
    ckr: state.ckr ? toBase64(state.ckr) : null,
    ns: state.ns,
    nr: state.nr,
    pn: state.pn,
    skipped: Array.from(state.skipped.entries()).map(([k, v]) => [k, toBase64(v)]),
  });
}

export function deserializeState(json: string): RatchetState {
  const o = JSON.parse(json);
  return {
    dhs: { publicKey: fromBase64(o.dhs.publicKey), privateKey: fromBase64(o.dhs.privateKey) },
    dhr: o.dhr ? fromBase64(o.dhr) : null,
    rk: fromBase64(o.rk),
    cks: o.cks ? fromBase64(o.cks) : null,
    ckr: o.ckr ? fromBase64(o.ckr) : null,
    ns: o.ns,
    nr: o.nr,
    pn: o.pn,
    skipped: new Map((o.skipped as [string, string][]).map(([k, v]) => [k, fromBase64(v)])),
  };
}
