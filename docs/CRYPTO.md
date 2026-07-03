# SecureChat — Cryptography & E2EE Design

> ⚠️ **Audit notice.** SecureChat builds on audited primitives (libsodium) and
> follows the published Signal protocol designs (X3DH + Double Ratchet). However,
> *this composition has not itself undergone an independent cryptographic audit.*
> Do not deploy to protect real people at risk until it has. See
> [SECURITY.md](./SECURITY.md).

This document describes the end-to-end encryption used by SecureChat. The
implementation lives in [`packages/crypto`](../packages/crypto/src) and is covered
by round-trip tests in [`crypto.test.ts`](../packages/crypto/src/crypto.test.ts).

## 1. Primitives (libsodium)

| Purpose                | Primitive                          | libsodium function                         |
|------------------------|------------------------------------|--------------------------------------------|
| Signing identity       | Ed25519                            | `crypto_sign_*`                            |
| DH / key agreement     | X25519                             | `crypto_box_keypair`, `crypto_scalarmult`  |
| AEAD (message sealing) | XChaCha20-Poly1305 (IETF)          | `crypto_aead_xchacha20poly1305_ietf_*`     |
| KDF                    | HKDF-SHA-256 (RFC 5869)            | built on `crypto_auth_hmacsha256`          |
| Fingerprint / hashing  | BLAKE2b                            | `crypto_generichash`                       |

We use the **sumo** libsodium build because it exposes raw `crypto_scalarmult`
and `crypto_auth_hmacsha256`, which X3DH and the ratchet require. (Its ESM bundle
is broken upstream; a committed pnpm patch repoints it to the working CJS build —
see `patches/`.)

All wire encodings are **URL-safe base64 without padding**.

## 2. Keys held by each device

Every device is an independent cryptographic endpoint. It generates:

- **Identity signing key** — Ed25519. Long-term. Signs prekeys and the device list.
- **Identity DH key** — X25519. Long-term. Used in X3DH.
- **Signed prekey** — X25519, rotated periodically, signed by the Ed25519 identity.
- **One-time prekeys** — a batch of X25519 keys; each is consumed by exactly one
  new inbound session, then deleted.

Only the **public** halves are ever uploaded (the *prekey bundle*). Private keys
never leave the device. See [`identity.ts`](../packages/crypto/src/identity.ts).

```ts
const identity = generateDeviceIdentity();          // Ed25519 + X25519
const signedPreKey = generateSignedPreKey(identity, 1);
const oneTimePreKeys = generateOneTimePreKeys(100, 1);
const bundle = buildPublicBundle(identity, signedPreKey, oneTimePreKeys[0]);
```

## 3. X3DH — asynchronous session setup

X3DH ([spec](https://signal.org/docs/specifications/x3dh/)) lets a sender derive a
shared secret with a recipient who is **offline**, using the recipient's published
prekey bundle. Implementation: [`x3dh.ts`](../packages/crypto/src/x3dh.ts).

**Initiator (Alice → Bob):**
1. Fetch Bob's bundle and **verify its signature** (`verifyBundleSignature`). If it
   fails, abort — a malicious server may be substituting keys.
2. Generate an ephemeral key `EK_A`.
3. Compute four Diffie-Hellman outputs (three if no one-time prekey is available):
   - `DH1 = DH(IK_A, SPK_B)`
   - `DH2 = DH(EK_A, IK_B)`
   - `DH3 = DH(EK_A, SPK_B)`
   - `DH4 = DH(EK_A, OPK_B)`  *(optional)*
4. `SK = HKDF( 0xFF·32 ‖ DH1 ‖ DH2 ‖ DH3 ‖ DH4 )`.
5. Send an initial header: `{ IK_A, EK_A, signedPreKeyId, oneTimePreKeyId? }`.

**Responder (Bob)** reconstructs the identical `SK` using the private halves of the
referenced prekeys, then **deletes the consumed one-time prekey**.

The `0xFF·32` prefix is the X25519 domain-separation constant from the X3DH spec.
The shared secret `SK` seeds the Double Ratchet.

## 4. Double Ratchet — per-message keys

The Double Ratchet ([spec](https://signal.org/docs/specifications/doubleratchet/))
gives every message its own key. Implementation:
[`doubleRatchet.ts`](../packages/crypto/src/doubleRatchet.ts).

Two ratchets compose:
- **Symmetric-key (chain) ratchet** — `KDF_CK` advances a chain key and derives one
  message key per message:
  - `mk  = HMAC-SHA256(ck, 0x01)`
  - `ck' = HMAC-SHA256(ck, 0x02)`
- **DH ratchet** — whenever a new ratchet public key arrives from the peer, both
  sides perform a DH and feed it through `KDF_RK` to advance the root key and start
  a fresh chain. This is what delivers **post-compromise security**.

Each message carries a header `{ dh, pn, n }` (sender's ratchet public key,
previous chain length, message number) which is bound into the AEAD as associated
data, then sealed with XChaCha20-Poly1305 under the message key.

**Security properties achieved (and tested):**
- **Forward secrecy** — message keys are derived then discarded; compromising the
  current state does not reveal past messages.
- **Post-compromise security** — a fresh DH ratchet step re-randomizes the session,
  so the session "self-heals" after a key compromise.
- **Out-of-order / lost messages** — skipped message keys are cached (bounded by
  `MAX_SKIP = 1000`) so late or reordered messages still decrypt.

```ts
// Initiator after X3DH:
const alice = initRatchetInitiator(init.sharedSecret, init.responderSignedPreKey);
const msg = ratchetEncrypt(alice, utf8ToBytes('hello'));

// Responder after X3DH:
const bob = initRatchetResponder(sharedSecret, bobSignedPreKey.keyPair);
const text = bytesToUtf8(ratchetDecrypt(bob, msg));
```

## 5. Multi-device (sender-fanout)

There is **no shared per-conversation key**. Each pair of devices runs its own
ratchet session. To send one logical message to a recipient who has N devices, the
sender encrypts it N times (once per device) and uploads N envelopes. The sender's
own other devices are included so history stays in sync. Device lists are signed by
the identity key so a malicious server cannot inject a rogue device unnoticed.

## 6. Files & images

Large content is never ratchet-encrypted inline. Instead:
1. Client generates a random per-file key and encrypts the file with
   XChaCha20-Poly1305 (chunked for large files).
2. The ciphertext blob is uploaded to object storage via a presigned URL.
3. The per-file key + blob reference are placed **inside** the ratchet-encrypted
   message body. The server sees only an opaque blob and its size.

## 7. Key verification (safety numbers)

`safetyNumber(localIdentityPub, remoteIdentityPub)` produces a stable, ordering-
independent 60-digit fingerprint (BLAKE2b over the sorted identity keys). Users
compare it out-of-band (or via QR) to detect a man-in-the-middle. Verification
status is surfaced in the chat info panel.

## 8. Local key storage & message log (client)

Private keys, serialized ratchet states, **and the decrypted message log** are
persisted in **IndexedDB**, all wrapped with a single key derived from the user's
passphrase (Argon2id → wrapping key → XChaCha20-Poly1305). On a page reload the API
session is restored from the refresh cookie, but the keys stay locked until the
user re-enters their passphrase (the *unlock* flow). Device compromise *plus* the
passphrase is required to read anything at rest.

**Why a local message log (not server history):** the Double Ratchet consumes a
message key on first decrypt (this is forward secrecy). Server-stored ciphertext
therefore *cannot be re-decrypted later* — by design. So, exactly as Signal does,
the authoritative copy of decrypted conversation history lives on the device, and
the server's role is delivery, not history. The server's ciphertext history is used
only to catch up on messages a device hasn't decrypted yet (offline / new device).

## 9. What the server can and cannot see

| The server sees                          | The server never sees                  |
|------------------------------------------|----------------------------------------|
| Usernames, display names, avatars        | Message plaintext                      |
| Public key bundles                       | Any private key                        |
| Who is a member of a conversation*       | Message keys / root keys / chain keys  |
| Ciphertext envelopes + headers + sizes   | File contents / file keys              |
| Timestamps, delivery/read state          | Typing/voice content                   |

\* Conversation membership and sender identity are metadata. Reducing this further
(sealed sender) is on the [roadmap](./ROADMAP.md); see the metadata threat model in
[SECURITY.md](./SECURITY.md).
