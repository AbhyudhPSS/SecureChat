import { sodium } from './sodium.js';
import type { RawKeyPair } from './identity.js';

/**
 * Sealed sender (metadata privacy for *who sent a message*).
 *
 * `crypto_box_seal` is an ANONYMOUS public-key box: the sender uses an ephemeral
 * key the recipient never sees, so the ciphertext carries no sender identity. We
 * wrap {senderIdentity, innerRatchetEnvelope} in a sealed box addressed to the
 * recipient device's X25519 identity key. The server stores/forwards this opaque
 * blob without learning the sender; only the recipient (with their identity
 * private key) can open it and discover who sent the message.
 *
 * Reference: https://signal.org/blog/sealed-sender/
 */

export function sealTo(recipientDhPublicKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return sodium.crypto_box_seal(plaintext, recipientDhPublicKey);
}

export function openSealed(dhKeyPair: RawKeyPair, sealed: Uint8Array): Uint8Array {
  return sodium.crypto_box_seal_open(sealed, dhKeyPair.publicKey, dhKeyPair.privateKey);
}
