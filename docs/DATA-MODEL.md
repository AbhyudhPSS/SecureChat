# SecureChat — Data Model

Source of truth: [`apps/server/prisma/schema.prisma`](../apps/server/prisma/schema.prisma).
PostgreSQL via Prisma. **Privacy invariant:** every content-bearing column holds
only client-produced ciphertext.

## Entity overview

```
User ──< Device ──< SignedPreKey
 │         │     └─< OneTimePreKey
 │         └─< (sends) Message
 │
 ├──< ConversationMember >── Conversation ──< Message ──< MessageEnvelope >── Device
 │                                              │   └─< Attachment
 │                                              └─< MessageReceipt
 └──< RefreshToken
```

## Tables

### `User`
Account record. `username` is unique and **discoverable** (search requires it);
everything sensitive is E2EE elsewhere. `passwordHash` is Argon2id — never
plaintext. Tracks `lastSeenAt` for presence fallback.

### `Device`
One per logged-in client. Holds the device's **public** key material
(`signingPublicKey` = Ed25519, `identityPublicKey` = X25519) and a
`registrationId`. Unique on `(userId, registrationId)`. Each device is an
independent E2EE endpoint.

### `SignedPreKey` / `OneTimePreKey`
Public prekeys uploaded by a device. A `OneTimePreKey` is **deleted** when first
consumed by an inbound session (X3DH). Both are unique on `(deviceId, keyId)` and
indexed by `deviceId` for fast bundle assembly.

### `Conversation`
`type` is `DIRECT` or `GROUP`. Carries no readable content. Indexed by
`updatedAt` for recent-conversation ordering.

### `ConversationMember`
Join row between `User` and `Conversation`. Unique on `(conversationId, userId)`.
`lastReadMessageId` drives unread counts and read receipts; `muted` / `archived`
are per-member UI state.

### `Message`
A **logical** message. Stores routing metadata only: `conversationId`,
`senderUserId`, `senderDeviceId`, timestamps, and `deletedAt` (soft delete /
"delete for everyone"). The plaintext exists only on client devices. Indexed by
`(conversationId, createdAt)` for history pagination.

### `MessageEnvelope`
The per-recipient-device ciphertext (sender-fanout). One row per recipient device
per message. `header` is the Double Ratchet header (JSON `{ dh, pn, n }`);
`ciphertext` is `nonce‖ct‖tag` (base64) — **opaque to the server**. `deliveredAt`
tracks delivery. The index `(recipientDeviceId, deliveredAt, createdAt)` powers the
"fetch my undelivered messages, oldest first" inbox query in one scan.

### `MessageReceipt`
Per-user delivery/read state (`DELIVERED` | `READ`). Unique on
`(messageId, userId, state)`. When a user disables read receipts, the client simply
never emits `READ`.

### `Attachment`
Reference to an encrypted blob in object storage: `blobKey` + `byteSize`. The
per-file decryption key is **not** here — it travels inside the E2EE message body.

### `RefreshToken`
Only a **SHA-256 hash** of the opaque refresh token is stored. `family` groups a
rotation lineage: refresh tokens rotate on every use, and reuse of an
already-rotated token revokes the whole family (theft detection). `expiresAt` /
`revokedAt` bound validity.

## Indexing & scale notes

- **Inbox fetch** (hot path): `MessageEnvelope(recipientDeviceId, deliveredAt,
  createdAt)` — a device pulls undelivered envelopes in one ranged index scan.
- **History pagination**: `Message(conversationId, createdAt)` — keyset pagination,
  no `OFFSET`.
- **Prekey assembly**: `SignedPreKey(deviceId)`, `OneTimePreKey(deviceId)`.
- At scale, time-partition `MessageEnvelope` and route history reads to replicas.
- `onDelete: Cascade` keeps deletes consistent (deleting a user removes its
  devices, keys, memberships, and envelopes).
