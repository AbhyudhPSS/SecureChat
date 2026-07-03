# SecureChat — Architecture

> Status: **Foundation (Pass 1)** — this document describes the target architecture
> and the parts implemented so far. See [ROADMAP.md](./ROADMAP.md) for what is built
> vs. planned, and [SECURITY.md](./SECURITY.md) for the threat model and honest
> limitations.

## 1. Goals

SecureChat is a private-by-design messaging platform. The defining constraints,
in priority order, are:

1. **Security** — the server is *untrusted* for message content. End-to-end
   encryption (E2EE) is mandatory and non-optional, with forward secrecy and
   post-compromise security.
2. **Reliability** — messages are durably queued per recipient device and
   delivered exactly once, in order, with read/delivery state.
3. **Scalability** — stateless app servers behind a load balancer; real-time
   fan-out via Redis pub/sub; Postgres as the durable store.
4. **Maintainability** — a typed monorepo with a shared crypto library and shared
   wire-contract types, so client and server cannot drift.
5. **User experience** — a fast, premium, dark-first, responsive UI.

## 2. High-level topology

```
                    ┌──────────────────────────────────────────────┐
                    │                  Clients                      │
                    │   Web (React/Vite)   ·   future: mobile/desktop│
                    │   - holds private keys  - runs X3DH + Ratchet  │
                    │   - encrypts/decrypts locally                  │
                    └───────────────┬───────────────┬───────────────┘
                          HTTPS REST │               │ WSS (realtime)
                                     ▼               ▼
                    ┌──────────────────────────────────────────────┐
                    │            App servers (Fastify, stateless)    │
                    │   /auth /users /keys /conversations /messages  │
                    │   /attachments        WebSocket gateway        │
                    └───┬───────────────┬───────────────┬───────────┘
                        │               │               │
                        ▼               ▼               ▼
                ┌──────────────┐ ┌─────────────┐ ┌────────────────┐
                │  PostgreSQL  │ │    Redis    │ │ Object storage  │
                │ (durable:    │ │ (presence,  │ │ (S3/MinIO:      │
                │  users,      │ │  typing,    │ │  encrypted      │
                │  ciphertext, │ │  pub/sub    │ │  file blobs)    │
                │  receipts)   │ │  fan-out)   │ │                 │
                └──────────────┘ └─────────────┘ └────────────────┘
```

**Key principle:** every byte of message content that touches Postgres or object
storage is ciphertext produced on a client. The server routes opaque blobs; it
holds no plaintext and no message keys.

## 3. Monorepo layout

```
SecureChat/
├─ docs/                 # design docs (this folder)
├─ packages/
│  ├─ crypto/            # ✅ E2EE library: X3DH + Double Ratchet (libsodium)
│  ├─ types/             # ✅ shared Zod DTOs / wire contract
│  └─ config/            # ✅ shared tsconfig + eslint presets
├─ apps/
│  ├─ server/            # ✅ Fastify API + Prisma + (planned) WS gateway
│  │  └─ prisma/         # ✅ schema + migrations
│  └─ web/               # ✅ React + Vite + Tailwind client shell
└─ infra/                # ✅ docker-compose: Postgres, Redis, MinIO
```

Tooling: **pnpm workspaces + Turborepo**, **TypeScript** everywhere, ESLint +
Prettier, Vitest for tests.

## 4. Component responsibilities

### 4.1 Client (`apps/web`)
- Generates and stores all **private** key material locally (IndexedDB, encrypted
  at rest — see [CRYPTO.md](./CRYPTO.md)). Private keys never leave the device.
- Runs **X3DH** to open sessions and the **Double Ratchet** to encrypt/decrypt
  every message.
- Encrypts files with a random per-file key before upload.
- Renders the UI: auth, conversation list, chat, presence, typing, receipts.

### 4.2 App server (`apps/server`)
- **Stateless.** Any instance can serve any request; horizontal scale is just
  more instances behind the LB.
- REST API for auth, user search, key-bundle publish/fetch, conversations,
  message history, and attachment presigning.
- WebSocket gateway for realtime delivery, typing, presence, and receipts.
- Persists ciphertext envelopes and routes them; never decrypts.

### 4.3 PostgreSQL
- Durable system of record: accounts, devices, public key bundles, conversation
  membership, **ciphertext** message envelopes, receipts, attachment references.
- See [DATA-MODEL.md](./DATA-MODEL.md).

### 4.4 Redis
- Ephemeral, low-latency state: online presence, typing indicators.
- **Pub/sub fan-out** so a message accepted by instance A is pushed to a recipient
  connected to instance B. This is what makes the WS gateway horizontally scalable.

### 4.5 Object storage (S3 / MinIO)
- Stores **encrypted** file/image blobs. Clients upload/download directly via
  short-lived presigned URLs; large files never proxy through the app server.

## 5. Core flows

### 5.1 Registration & device provisioning
1. Client generates identity keys (Ed25519 + X25519), a signed prekey, and a batch
   of one-time prekeys.
2. Client `POST /auth/register` with username, display name, password, and the
   **public** prekey bundle.
3. Server hashes the password with **Argon2id**, atomically creates the user,
   device, and key rows, and returns an access token (+ httpOnly refresh cookie).

### 5.2 Opening a conversation (X3DH)
1. Sender `GET /keys/:userId/bundle` → server returns one prekey bundle per
   recipient device and **consumes** a one-time prekey.
2. Sender verifies the bundle signature, runs X3DH → shared secret, and
   initializes a Double Ratchet session per recipient device.

### 5.3 Sending a message (sender-fanout)
1. For each recipient device, the client ratchet-encrypts the message → one
   ciphertext envelope per device.
2. `POST /messages` with the conversation id and the array of per-device
   envelopes.
3. Server stores envelopes, then publishes a `message` event on each recipient's
   Redis channel; online devices receive it instantly over WS, offline devices
   fetch it on reconnect.

### 5.4 Receipts, typing, presence
- Delivery/read receipts and typing indicators flow over WS and are fanned out via
  Redis. Read receipts are suppressible via privacy settings.

## 6. Scalability model

- **App servers**: stateless → scale horizontally. Sticky sessions are *not*
  required because cross-instance delivery goes through Redis pub/sub.
- **Postgres**: partition hot tables (`MessageEnvelope`) by time; read replicas for
  history queries; the inbox query is a single indexed scan
  (`recipientDeviceId, deliveredAt, createdAt`).
- **Redis**: cluster mode for pub/sub and presence at scale.
- **Object storage**: effectively unbounded; offloads bandwidth from app servers.

## 7. Technology choices & rationale

| Concern        | Choice                     | Why                                                        |
|----------------|----------------------------|------------------------------------------------------------|
| Crypto         | libsodium (X3DH + Ratchet) | Audited primitives; Signal-proven protocol design          |
| API server     | Fastify                    | Fast, schema-first, first-class TypeScript                 |
| Realtime       | WebSocket + Redis pub/sub  | Low latency, horizontally scalable fan-out                 |
| ORM / DB       | Prisma / PostgreSQL        | Type-safe queries, migrations, strong relational integrity |
| Password hash  | Argon2id                   | Memory-hard, current OWASP recommendation                  |
| Frontend       | React + Vite + Tailwind    | Fast DX, premium UI, small bundles                         |
| Validation     | Zod (shared)               | One source of truth for the wire contract                  |

See [CRYPTO.md](./CRYPTO.md), [DATA-MODEL.md](./DATA-MODEL.md), and
[API.md](./API.md) for the details of each.
