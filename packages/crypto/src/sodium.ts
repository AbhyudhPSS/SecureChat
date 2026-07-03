import _sodium from 'libsodium-wrappers-sumo';

/**
 * libsodium initializes asynchronously (it compiles a WASM module). Every entry
 * point in this package must `await ready()` before touching `sodium`.
 *
 * We export the *sumo* build because it includes the lower-level primitives
 * (raw scalar multiplication, HMAC-SHA256) that the X3DH and Double Ratchet
 * constructions depend on.
 */
let initialized = false;

export async function ready(): Promise<typeof _sodium> {
  if (!initialized) {
    await _sodium.ready;
    initialized = true;
  }
  return _sodium;
}

/**
 * Synchronous accessor. Only safe to call after `ready()` has resolved at least
 * once. Prefer awaiting `ready()` at the boundary of any public operation.
 */
export const sodium = _sodium;
