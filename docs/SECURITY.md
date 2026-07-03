# SecureChat — Security & Threat Model

This document states honestly what SecureChat protects against, what it does not
(yet), and the engineering controls in place. Cryptographic detail is in
[CRYPTO.md](./CRYPTO.md).

> ⚠️ **Not yet audited.** The crypto composition has not had an independent
> professional audit. Treat SecureChat as a strong foundation, not a guarantee for
> at-risk users, until that audit happens.

## 1. Security goals

1. **Confidentiality** — only the intended recipient devices can read a message.
2. **Integrity / authenticity** — tampering is detected (AEAD); messages are bound
   to their sender's ratchet identity.
3. **Forward secrecy & post-compromise security** — see Double Ratchet in CRYPTO.md.
4. **Server-untrusted content** — a fully compromised server cannot read messages.
5. **Metadata minimization** — reduce what the server learns about *who talks to
   whom*, as far as is practical (see §4 for the honest limits).

## 2. Adversaries considered

| Adversary | Capability | Outcome |
|-----------|-----------|---------|
| **Honest-but-curious server** | Reads all DB rows & blobs | Sees ciphertext + metadata; **no plaintext, no keys** |
| **Fully compromised server** | Modifies data, serves keys | Cannot read past/future messages (E2EE). Can attempt key substitution → defeated by **bundle signatures + safety-number verification** |
| **Network attacker (MITM)** | Intercepts transport | Defeated by TLS + E2EE; cannot downgrade encryption |
| **Stolen device (locked)** | Has the ciphertext-at-rest | Keys are wrapped by an Argon2id passphrase key → needs the passphrase too |
| **Malicious peer** | A conversation participant | Can of course read messages they're in; cannot forge others' messages |

## 3. Controls implemented / specified

### Authentication & sessions
- **Argon2id** password hashing (memory-hard; OWASP baseline params). ✅
- **Short-lived JWT access tokens** + **rotating refresh tokens**; only a SHA-256
  hash of the refresh token is stored; **reuse of a rotated token revokes the whole
  family** (theft detection). ✅ (rotation endpoint 🔜)
- Refresh token delivered as an **httpOnly, SameSite=strict, Secure** cookie scoped
  to `/auth` → mitigates XSS token theft and CSRF. ✅

### Transport & web
- TLS everywhere in production; CORS locked to the configured web origin with
  credentials. ✅
- Request bodies validated with **Zod** (input validation / injection resistance). ✅
- Fastify body-size limits; large uploads bypass the app via presigned URLs. ✅
- 🔜 Rate limiting (auth + messages), security headers (CSP, HSTS, etc.),
  per-account abuse controls.

### Cryptographic
- E2EE is **mandatory** — there is no plaintext code path to the server. ✅
- Prekey bundles are **signed** and verified before use (`verifyBundleSignature`),
  blocking server key substitution. ✅
- **Safety numbers** for out-of-band identity verification. ✅
- AEAD binds each ciphertext to its ratchet header (associated data). ✅
- Private keys are generated and stored only on the client, wrapped at rest. ✅ (design)

### Data
- All message/attachment content columns hold **ciphertext only**. ✅
- `onDelete: Cascade` ensures account deletion removes derived data. ✅

## 4. Metadata — the honest limits

The product goal is that *who is chatting should not be discoverable*. Full E2EE
hides **content** but not all **metadata**. Here is the real picture:

**What is currently hidden:** message content, attachments, keys — unconditionally.

**Length hiding (shipped):** all message plaintext is **padded to fixed 256-byte
buckets** before encryption (`packages/crypto/padding.ts`), so the stored/forwarded
ciphertext length reveals only the bucket, not the exact message length.

**Sealed-sender transport (shipped, verified):** SecureChat includes a sealed
delivery path (`POST /sealed`) where:
- the sender's identity is sealed *inside* the message (anonymous `crypto_box_seal`
  to the recipient device's identity key) — `packages/crypto/sealedSender.ts`;
- delivery is authorized by the **recipient's opaque delivery token**, not by sender
  authentication, so the server never learns who sent the message;
- the stored row (`SealedMessage`) has **no sender and no conversation columns** —
  only the recipient device id and the opaque blob.
This is proven by `apps/server/scripts/verify-sealed.mjs` (7/7).

**Honest status of the main path:** the primary messaging path (`POST /messages`,
used by the UI today) still records `senderUserId`/`senderDeviceId` and conversation
membership for routing, receipts, and membership enforcement — so on that path a
compromised server can still build a social graph. Migrating the UI onto the sealed
transport requires reworking receipts and membership checks to operate without server
knowledge of the sender (the recipient enforces membership after unsealing); that
migration is the remaining metadata-privacy work.

**What E2EE fundamentally cannot hide on its own:** network-layer metadata (your IP,
when you're online, traffic timing/volume). Defeating a global network observer
requires anonymity transport (Tor / mixnet / cover traffic). Sealed sender removes the
*stored* sender identity but a server observing request timing could still correlate;
full unlinkability is a research-grade addition we explicitly do not claim to provide.

## 5. Operational security (deployment)

- Secrets (`JWT_*`, DB, S3) come from the environment; `.env` is git-ignored.
  Generate strong secrets: `openssl rand -base64 48`.
- Run the DB and object storage on private networks; expose only the app + TLS.
- Back up Postgres (ciphertext is safe at rest, but availability still matters).
- Rotate signing/prekeys on a schedule; expire and prune consumed one-time prekeys.

## 6. Responsible disclosure

Until a formal process exists, treat any finding as sensitive and report it
privately to the maintainers. Do not test against accounts you do not own.
