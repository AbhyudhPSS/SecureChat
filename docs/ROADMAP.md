# SecureChat — Roadmap

Phased plan. Each phase is independently reviewable and leaves the app in a
working state. ✅ = done in Pass 1.

## Pass 1 — Foundation ✅ (this delivery)

- ✅ Monorepo (pnpm + Turbo), shared `config`, shared `types` (Zod wire contract).
- ✅ `packages/crypto`: X3DH + Double Ratchet on libsodium, with passing round-trip
  tests (forward secrecy, out-of-order delivery, state persistence, bundle-signature
  verification, safety numbers).
- ✅ `prisma/schema.prisma`: full data model + initial migration.
- ✅ `apps/server`: Fastify boot, config validation, `/health`, Prisma wiring, and a
  working `POST /auth/register` (Argon2id + atomic user/device/prekey creation),
  verified end-to-end into Postgres.
- ✅ `apps/web`: React + Vite + Tailwind dark-first shell — premium auth screen and
  chat layout (sidebar, chat area, info panel, typing/receipt UI), responsive.
- ✅ `infra/docker-compose.yml`: Postgres + Redis + MinIO, verified healthy.
- ✅ Design docs (architecture, crypto, data model, API, security, this roadmap).

## Pass 2 — Authentication & accounts ✅ (delivered)

- ✅ `login`, `refresh` (single-use rotation + family revocation / theft detection),
  `logout` — all integration-tested (15/15 checks).
- ✅ Client key generation + **encrypted IndexedDB** keystore (Argon2id-wrapped via
  libsodium `crypto_pwhash`; verified: persists, unlocks, rejects wrong passphrase,
  no plaintext key leakage).
- ✅ Real auth wiring in the web client: register/login/logout, in-memory access
  token with single-flighted silent refresh, session restore on reload.
- ✅ `users/me` (GET/PATCH) + profile editing UI; settings page (profile, privacy,
  security, devices tabs).
- ✅ Rate limiting (@fastify/rate-limit) + security headers (@fastify/helmet).
- ✅ Verified end-to-end in a real browser (register → keystore → chat shell →
  reload-restore → logout). Bugs found & fixed during verification: refresh-token
  single-flighting, animation-independent screen switching, and reading libsodium
  AEAD constants at call-time (async WASM init in browsers).
- Deferred to later: avatar upload pipeline, full CSRF token (currently mitigated by
  SameSite=strict + httpOnly cookie scoped to /auth), enforcing privacy toggles.

## Pass 3 — Messaging core ✅ (delivered)

- ✅ `GET /keys/:userId/bundle` (per-device, atomic one-time-prekey consumption).
- ✅ Client session manager: X3DH on first contact, per-peer-device Double Ratchet,
  sessions persisted (wrapped) in IndexedDB.
- ✅ `POST /messages` (sender-fanout, ciphertext-only) + keyset-paginated history.
- ✅ **WebSocket gateway** (`/ws`) + **Redis pub/sub** fan-out across instances,
  with presence heartbeats.
- ✅ Real-time delivery, **typing indicators**, **online/offline presence**
  (with `GET /presence` seeding), **delivery + read receipts**.
- ✅ User search (`GET /users/search`) + start-conversation flow in the UI.
- ✅ **Local encrypted message log**: because the Double Ratchet consumes a key on
  first decrypt (forward secrecy), decrypted history lives on-device (Signal-style);
  the server only delivers. Survives reload via the unlock flow.
- ✅ Verified server-side (14/14 two-user E2E: X3DH+ratchet, receipts, typing,
  bidirectional, history) AND in a real browser (live chat with an echo bot:
  encrypted send/receive, typing, presence, receipts, reload-persist).
- Bugs found & fixed in verification: presence TTL heartbeat (passive sockets),
  forward-secrecy-safe local history (don't re-decrypt server ciphertext).
- Deferred: encrypt to sender's *own* other devices (multi-device sync) — Pass 5;
  offline push; group chats — Pass 6.

## Pass 4 — Files, media & search ✅ (delivered)

- ✅ Encrypted attachment pipeline: fresh per-file key (XChaCha20-Poly1305),
  presigned **direct** upload/download to S3/MinIO (bytes never touch the app
  server), per-file key carried inside the E2EE message body.
- ✅ Download authorization (only conversation members get a presigned GET).
- ✅ Image previews rendered inline (download → decrypt → object URL) and file
  attachments as downloadable chips; attach button in the composer.
- ✅ Client-side **message search** over the local decrypted log — runs entirely
  on-device, so the server never sees the query or plaintext.
- ✅ Verified: server E2E (8/8 — MinIO upload, ciphertext-only, recipient
  decrypt, non-member 403) and in-browser (image send → render via MinIO with
  working CORS; search finds local messages).
- Deferred: chunked/streaming encryption for very large files (libsodium
  secretstream), client-generated thumbnails, shared-media gallery in the info
  panel.

## Pass 5 — Multi-device & settings ✅ (delivered)

- ✅ **Own-device fan-out**: each message is also encrypted to the sender's other
  devices, so conversations sync across a user's logged-in devices (new messages;
  pre-existing history isn't retro-synced — see note).
- ✅ Per-device sessions (already the model — every device is an independent X3DH +
  ratchet endpoint; logging in on a new browser provisions a new device).
- ✅ **Device management**: `GET /devices`, `DELETE /devices/:id` (soft-revoke →
  drops the device from prekey bundles + revokes its refresh tokens). Settings →
  Devices tab lists real devices with a "This device" badge + revoke.
- ✅ **Safety-number verification UI** in the conversation info panel (BLAKE2b over
  both identity keys), plus a non-consuming `GET /keys/:userId/identity` endpoint.
- ✅ Verified: 10/10 multi-device E2E (two devices, own-device sync, list, revoke,
  revoked-excluded-from-bundles, revoked-can't-refresh) + in-browser (safety number
  renders, Devices tab lists the current device).
- Notes / deferred: QR-based provisioning (a *shared* user identity across devices,
  Signal's linked-device model) is an alternative to our independent-device model and
  is deferred; retro-syncing old history to a new device; one-time-prekey
  replenishment (X3DH falls back to 3-DH when exhausted, so messaging still works).

## Pass 6 — Groups ✅ (delivered)

- ✅ Group conversations via **per-member-device fan-out** (the same pairwise Double
  Ratchet as 1:1, applied to every member's devices). Direct + group share ONE send
  path; there is no shared group key, so **no group-key rotation is needed** —
  removing a member simply excludes them from future fan-out.
- ✅ Membership management with **admin roles** (OWNER/ADMIN/MEMBER): create group,
  add/remove members, promote/demote, self-leave — all role-gated server-side.
- ✅ Server hardening: messages are rejected if any recipient device is not a
  current member (`recipient_not_member`); group detail is members-only.
- ✅ UI: create-group modal, group header + member count, **sender names** in group
  bubbles, and a group info panel (members, role badges, add/remove/promote, leave).
- ✅ Verified: 15/15 group E2E (create, roles, multi-recipient encrypt+decrypt,
  add/remove, non-member rejection, leave) + in-browser (create group with a bot,
  send, bot echoes into the group with sender name, member panel).
- Notes / deferred: Sender Keys (an efficiency optimization for very large groups —
  one ciphertext per message instead of per-member) is deferred; per-member fan-out
  is correct and simplest for moderate group sizes.

## Pass 7 — Metadata privacy hardening ✅ (delivered, partial by design)

- ✅ **Ciphertext padding (live)**: plaintext padded to fixed 256-byte buckets before
  encryption, so ciphertext length no longer leaks message length. Integrated into the
  live client + bot; covered by crypto tests.
- ✅ **Sealed-sender transport + opaque delivery tokens (verified)**: `POST /sealed`
  delivers a `crypto_box_seal` blob authorized only by the recipient's delivery token —
  the server stores no sender and no conversation (`SealedMessage` has only the
  recipient device id + blob). Proven by `verify-sealed.mjs` (7/7).
- ⚠️ **Honest limit**: the UI still uses the sender-revealing `POST /messages` path
  (needed for the current receipt + membership model). Migrating the UI to the sealed
  transport — reworking receipts/membership to run without server knowledge of the
  sender — is the remaining work. Full network-level unlinkability (Tor/mixnet, timing
  decorrelation, cover traffic) is out of scope and not claimed. See SECURITY.md §4.

## Pass 8 — Production hardening ✅ (delivered; audit + cloud deploy are external)

- ✅ **Test harness**: `pnpm test:e2e` aggregates all 7 integration suites (auth,
  messaging, attachments, multi-device, groups, sealed sender) over the live API +
  WebSocket; 24 crypto unit tests. Lint green across all source.
- ✅ **Observability**: `/metrics` (Prometheus text), per-response `x-request-id`,
  structured pino logs, `/health` + `/health/ready`.
- ✅ **Hardening**: production-only strict rate limits on `/auth/*`, helmet security
  headers, env validation at boot.
- ✅ **CI**: `.github/workflows/ci.yml` — lint, typecheck, unit, build + an e2e job
  with Postgres/Redis/MinIO service containers running `pnpm test:e2e`.
- ✅ **Production Docker**: multi-stage server image (**build verified**), web→nginx
  image, `infra/docker-compose.prod.yml`, `.dockerignore`.
- ✅ **Docs**: [PRODUCTION.md](./PRODUCTION.md) (deploy/scale/secrets/backup/checklist)
  and [AUDIT.md](./AUDIT.md) (auditor orientation + questions + known limits).
- ⚠️ **External steps (cannot be done in-repo)**: the **independent cryptographic
  audit** itself, and a real cloud deploy with blue/green + DB read replicas, are
  organizational/infra steps — this pass produces the artifacts and checklists for
  them. Do not launch to at-risk users before the audit.

## Rich media — emoji, voice messages & calls ✅ (delivered)

- ✅ **Emoji picker**: dependency-free categorized picker in the composer.
- ✅ **Voice messages**: MediaRecorder capture → encrypted as a normal attachment
  (per-file key, ciphertext-only on the server) with a `voice` kind + duration; an
  inline play/pause player with a progress bar.
- ✅ **Voice & video calls (1:1)**: WebRTC with signaling relayed through the
  gateway (`call` events over Redis fan-out, membership-checked). **Media is
  peer-to-peer and end-to-end encrypted by WebRTC's mandatory DTLS-SRTP — it never
  touches the server.** STUN for NAT traversal; full-screen call UI with
  mute/camera-toggle/hangup and an incoming-call prompt.
- ✅ Verified: signaling relay E2E (`verify-calls.mjs`, 5/5 incl. the non-member
  guard) + in-browser (emoji insertion, composer mic, header call buttons render).
- Notes / deferred: a **TURN** server is required for symmetric NATs (STUN-only
  today; configure in `lib/calls.ts`); **group calls** need an SFU and are deferred;
  signaling SDP/ICE is relayed in the clear (media is still E2EE) — sealing it is a
  metadata refinement. Real mic/camera/peer media can't be exercised headlessly.

## Encrypted chat backup ✅ (delivered)

- ✅ One-tap backup of the local message history + keys + ratchet sessions, wrapped
  with a user-chosen passphrase (Argon2id) — **end-to-end encrypted; the server can't
  read it**. Store on the server or download as a `.scbackup` file; restore from
  either (wrong passphrase fails cleanly).
- ✅ Server store: one opaque `Backup` blob per user (`PUT`/`GET`/`DELETE /backup`).
  Settings → Backup tab drives it.
- ✅ Verified: server blob round-trip + passphrase encrypt/decrypt
  (`verify-backup.mjs`, 8/8) + in-browser (back up to server, restore).

## Group calls ✅ (delivered)

- ✅ Group **audio & video** calls via a full WebRTC **mesh** (every participant
  holds a direct peer connection to every other), so media stays end-to-end
  encrypted (DTLS-SRTP) with **no media server**. Mesh coordination: `invite` →
  `join` → glare-free pairing (smaller userId offers). Multi-tile call grid; group
  call buttons in the group header.
- ✅ Verified: mesh signaling fan-out + non-member exclusion (`verify-group-calls.mjs`,
  6/6) + in-browser (group call buttons render).
- Notes / deferred: mesh suits small groups (~4–6); large groups need an **SFU**
  (which trades off E2EE) — deferred. TURN still required for symmetric NATs.

## Profile editing ✅ (delivered)

- ✅ Edit **display name, username** (uniqueness-checked, `409` on conflict), **bio**,
  and **avatar** (upload an image → presigned object storage → blob key on the
  profile). A reusable `Avatar` component resolves blob keys to short-lived URLs and
  shows avatars across the sidebar, conversation rows, chat header, and settings.
- Note: avatars/bios/usernames are **profile-public** (server- and contact-visible),
  consistent with usernames being discoverable — they are NOT E2EE (documented in
  SECURITY.md). Verified: `verify-profile.mjs` (7/7) + in-browser (avatar upload,
  name/username save, propagation to the sidebar).

## Cross-cutting (ongoing)

- Accessibility (WCAG), i18n, offline/PWA support.
- Push notifications (without leaking content).
- Backup/restore, account deletion/export (GDPR).
