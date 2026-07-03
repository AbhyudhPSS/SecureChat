/**
 * @securechat/crypto — isomorphic end-to-end encryption library.
 *
 * Layers:
 *   - sodium / encoding / kdf / aead : primitives
 *   - identity                        : long-term + prekey material (X3DH infra)
 *   - x3dh                            : asynchronous key agreement
 *   - doubleRatchet                   : per-message forward-secret ratchet
 *
 * Always `await ready()` once before using any other export.
 */
export { ready, sodium } from './sodium.js';
export * from './encoding.js';
export * from './kdf.js';
export * from './aead.js';
export * from './identity.js';
export * from './x3dh.js';
export * from './doubleRatchet.js';
export * from './keystore.js';
export * from './file.js';
export * from './padding.js';
export * from './sealedSender.js';
