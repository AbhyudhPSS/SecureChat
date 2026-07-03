# SecureChat — Cryptographic Audit Readiness

> **SecureChat has NOT been independently audited.** It is built on audited
> primitives (libsodium) and follows the published Signal designs, but the
> *composition* and *implementation* must be reviewed by qualified cryptographers
> before protecting anyone at real risk. This document orients an auditor and
> records the assumptions we are asking them to check.

## Scope for an audit

The cryptographic core is small and self-contained — start here:

- [`packages/crypto/src/identity.ts`](../packages/crypto/src/identity.ts) — key
  generation, prekey bundles, bundle-signature verification, safety numbers.
- [`packages/crypto/src/x3dh.ts`](../packages/crypto/src/x3dh.ts) — X3DH agreement.
- [`packages/crypto/src/doubleRatchet.ts`](../packages/crypto/src/doubleRatchet.ts)
  — Double Ratchet (root/chain/DH ratchets, skipped keys).
- [`packages/crypto/src/aead.ts`](../packages/crypto/src/aead.ts),
  [`kdf.ts`](../packages/crypto/src/kdf.ts),
  [`padding.ts`](../packages/crypto/src/padding.ts),
  [`sealedSender.ts`](../packages/crypto/src/sealedSender.ts),
  [`keystore.ts`](../packages/crypto/src/keystore.ts) — AEAD, HKDF, length-hiding
  padding, sealed sender, at-rest key wrapping.

Design intent is documented in [CRYPTO.md](./CRYPTO.md); the threat model and honest
limits are in [SECURITY.md](./SECURITY.md).

## Specific questions for reviewers

1. **KDF construction** — HKDF-SHA256 built on `crypto_auth_hmacsha256`
   (`kdf.ts`): is the extract/expand and the salt normalization correct per RFC 5869?
2. **X3DH** — DH ordering, the `0xFF·32` domain-separation prefix, the
   3-DH-vs-4-DH fallback when no one-time prekey is available, and one-time-prekey
   consumption semantics.
3. **Double Ratchet** — root/chain/DH ratchet correctness, `MAX_SKIP` bound, skipped
   message-key storage/lifetime, header binding into AEAD associated data, and the
   asymmetric initiator/responder initialization.
4. **AEAD** — XChaCha20-Poly1305 nonce handling (random 192-bit), no nonce reuse.
5. **Padding** — ISO 7816-4 bucketing; does it leak via timing/structure; bucket
   size choice (256B) vs. message-size distribution.
6. **Sealed sender** — `crypto_box_seal` anonymity guarantees; what the delivery
   token does and does not protect (note: the server still observes request timing).
7. **At-rest key wrapping** — Argon2id (`crypto_pwhash`) parameters
   (INTERACTIVE) for the device keystore; are they adequate for the threat model?
8. **State persistence** — serialized ratchet state and the local message log are
   wrapped with the passphrase-derived key; check for plaintext leakage paths.
9. **Identity continuity** — bundle signatures + safety numbers as the only defense
   against a malicious server substituting keys (no key transparency yet).
10. **Randomness** — all randomness is from libsodium (`randombytes_buf`,
    keygens); confirm no `Math.random` in security paths.

## Known limitations the audit should weigh (not bugs)

- **Metadata**: the live UI path records sender + conversation membership; sealed
  sender is implemented but not yet the UI default (see SECURITY.md §4).
- **No key transparency / no PQ**: trust is TOFU + manual safety-number comparison;
  no post-quantum KEM.
- **Group keying**: per-member pairwise fan-out (no Sender Keys), so no shared group
  key to leak — but message size scales with membership.
- **Forward secrecy vs. history**: consumed message keys can't re-decrypt server
  history; the authoritative plaintext log lives on the device.

## Reproducing the test evidence

```bash
pnpm --filter @securechat/crypto test    # 24 unit tests (X3DH, ratchet, AEAD,
                                          # padding, sealed sender, keystore, file)
pnpm test:e2e                             # 7 integration suites over the live API
```
Tests are evidence of *intended behavior*, not a substitute for review.
