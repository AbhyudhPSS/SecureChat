# SecureChat — API & Realtime Protocol

Wire contracts are defined once in [`packages/types`](../packages/types/src/index.ts)
(Zod schemas) and shared by server and client. Status legend: ✅ implemented in
Pass 1 · 🔜 specified, built in a later pass (see [ROADMAP.md](./ROADMAP.md)).

Base URL: `http://localhost:4000` (dev). All bodies are JSON. Auth uses a short
JWT **access token** in `Authorization: Bearer <token>` plus an httpOnly **refresh
cookie** scoped to `/auth`.

## REST

### Health
- ✅ `GET /health` → `{ status: "ok", uptime }` — liveness, no DB.
- ✅ `GET /health/ready` → `200 { db: "up" }` or `503` — readiness (checks DB).

### Auth
- ✅ `POST /auth/register`
  Body: `{ username, displayName, password, device: PreKeyBundle }`.
  Creates account + first device + prekeys atomically; Argon2id-hashes the
  password. → `201 { user, deviceId, accessToken }` (+ refresh cookie).
  Errors: `400 invalid_input`, `409 username_taken`.
- ✅ `POST /auth/login` → verify password (timing-uniform for unknown users),
  upsert the presenting device + prekeys, issue tokens. Body adds `device`.
  → `200 { user, deviceId, accessToken }`. Error: `401 invalid_credentials`.
- ✅ `POST /auth/refresh` → rotate the single-use refresh cookie; **reuse of a
  rotated token revokes the whole family** (theft detection). → `200 AuthResult`.
- ✅ `POST /auth/logout` → revoke the current refresh family + clear the cookie.

### Users
- ✅ `GET /users/me` → current profile (auth required).
- ✅ `PATCH /users/me` → update username (`409 username_taken`) / display name / bio /
  avatar (the avatar value is an object-storage blob key).
- ✅ `GET /users/:id/avatar` → short-lived presigned URL for a user's avatar image
  (profile-public), or `{ url: null }`.
- ✅ `GET /users/search?q=` → search by username (≥2 chars, excludes self).
- ✅ `GET /presence?ids=a,b,c` → `{ onlineUserIds }` (seeds initial presence).

### Devices & keys
- ✅ `GET /devices` → list my active devices (`current` flags the calling device).
- ✅ `DELETE /devices/:id` → soft-revoke a device (drops it from prekey bundles +
  revokes its refresh tokens). New devices are provisioned by logging in.
- 🔜 `POST /keys/bundle` → replenish one-time prekeys for a device.
- ✅ `GET /keys/:userId/bundle` → fetch one bundle **per non-revoked recipient
  device**; **consumes** a one-time prekey per device. Used to start X3DH.
- ✅ `GET /keys/:userId/identity` → per-device identity keys, **without** consuming
  prekeys. Used for safety-number computation.

### Conversations
- ✅ `GET /conversations` → my conversations (peer/title, type, member count, last
  activity, unread counts).
- ✅ `POST /conversations` → create/open a DIRECT conversation (`{ peerUserId }`).
- ✅ `POST /conversations/group` → create a GROUP (`{ title, memberUserIds }`);
  creator becomes OWNER.
- ✅ `GET /conversations/:id` → full detail (members + roles); members only.
- ✅ `POST /conversations/:id/members` → add members (admin/owner).
- ✅ `DELETE /conversations/:id/members/:userId` → remove a member (admin) or leave (self).
- ✅ `PATCH /conversations/:id/members/:userId` → set role ADMIN/MEMBER (admin/owner).
- 🔜 `PATCH /conversations/:id` → mute / archive.

### Messages
- ✅ `POST /messages`
  Body: `{ conversationId, senderDeviceId, envelopes: Envelope[] }` where each
  `Envelope = { recipientDeviceId, x3dh?, header, ciphertext }`. Stores envelopes and
  fans out over Redis → WS. → `201 { messageId, createdAt }`.
- ✅ `GET /conversations/:id/messages?before=&limit=` → keyset-paginated history
  of envelopes addressed to the calling device (ciphertext; see CRYPTO.md on why
  clients keep a local plaintext log).
- 🔜 `DELETE /messages/:id` → soft delete / delete-for-everyone.

### Backup
- ✅ `PUT /backup` → store the passphrase-encrypted backup blob (opaque to server).
- ✅ `GET /backup/info` → `{ exists, updatedAt, size }`.
- ✅ `GET /backup` → the encrypted blob (to restore). `DELETE /backup` → remove it.

### Attachments
- ✅ `POST /attachments/presign-upload` → `{ uploadUrl, blobKey }` (client encrypts,
  then PUTs the ciphertext directly to object storage; 5-min URL).
- ✅ `GET /attachments/download?blobKey=…` → `{ downloadUrl }` — authorized to
  conversation members only; short-lived presigned GET.
- The per-file decryption key is carried inside the E2EE message body, never here.

## WebSocket (`/ws`)

🔜 Authenticated by passing the access token on connect. Heartbeat via
`ping`/`pong`. JSON messages. Cross-instance delivery via Redis pub/sub, so a
client connected to any server instance receives events accepted by any other.

### Client → server (`WsClientEvent`)
```ts
{ type: 'typing', conversationId, isTyping }
{ type: 'read',   conversationId, messageId }
{ type: 'ping' }
// WebRTC call signaling, relayed to a peer (membership-checked):
{ type: 'call', toUserId, conversationId, signal: CallSignal }
```

### Server → client (`WsServerEvent`)
```ts
{ type: 'message',  message }
{ type: 'typing',   conversationId, userId, isTyping }
{ type: 'receipt',  conversationId, messageId, userId, state: 'DELIVERED' | 'READ' }
{ type: 'presence', userId, online, lastSeenAt }
{ type: 'ready',    onlineUserIds }
{ type: 'call',     fromUserId, conversationId, signal: CallSignal }
{ type: 'pong' }
```

`CallSignal = { callId, kind: 'offer'|'answer'|'ice'|'end'|'reject'|'busy', media?, sdp?, candidate?, fromDeviceId? }`.
Signaling is relayed; the call MEDIA is peer-to-peer and end-to-end encrypted by
WebRTC (DTLS-SRTP) and never passes through the server.

Voice messages reuse the encrypted attachment pipeline (an attachment with
`kind: 'voice'` + `durationMs`); emoji are plain Unicode in the message text.

## Conventions

- **Validation**: every request body is parsed with its Zod schema; failures return
  `400 invalid_input` with field-level details.
- **Errors**: `{ error: string, details?: unknown }` with a matching HTTP status.
- **Rate limiting** (🔜): per-IP and per-user limits on auth and message endpoints.
- **Idempotency** (🔜): `POST /messages` accepts a client-generated id to make
  retries safe (exactly-once delivery).
