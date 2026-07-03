# 🔐 SecureChat

A modern, **end-to-end encrypted** messaging platform — private by design. Built on
the Signal protocol (X3DH + Double Ratchet over libsodium), with a premium,
dark-first UI.

> **Status: feature-complete foundation (Passes 1–8 + rich media done).** Auth;
> end-to-end encrypted 1:1 + group messaging over WebSocket (X3DH + Double Ratchet);
> typing/presence/receipts; encrypted attachments; **emoji**, **encrypted voice
> messages**, and **1:1 + group voice/video calls** (WebRTC mesh, DTLS-SRTP media —
> never touches the server); **encrypted chat backup/restore**; **profile editing
> (avatar, username, name, bio)**; client-side search; multi-device; device + group
> management; length-hiding padding; a verified
> sealed-sender transport; observability, CI, and production Docker — all implemented
> and verified (24 crypto unit tests + 10 end-to-end suites + in-browser checks).
>
> **The two things left are external, not code:** an **independent cryptographic
> audit** and a real cloud deployment. The repo ships the artifacts and checklists
> for both ([docs/AUDIT.md](docs/AUDIT.md), [docs/PRODUCTION.md](docs/PRODUCTION.md)).
> Do not use this to protect at-risk users before the audit.
>
> ⚠️ The encryption is **not yet independently audited**. Don't use it to protect
> people at real risk until it is. See [docs/SECURITY.md](docs/SECURITY.md).

## Why it's private

- Messages are encrypted **on the device** before they leave it; the server only
  ever stores and routes **ciphertext**. A compromised server cannot read messages.
- **Forward secrecy + post-compromise security** via the Double Ratchet.
- Private keys never leave your device. Prekey bundles are signed; safety numbers
  let you verify there's no man-in-the-middle.
- Honest about limits: E2EE hides *content*, not all *metadata* — read
  [docs/SECURITY.md §4](docs/SECURITY.md) for exactly what the server can and can't see.

## Tech stack

React + Vite + Tailwind · Fastify · Prisma + PostgreSQL · Redis · libsodium ·
S3/MinIO · pnpm + Turborepo · TypeScript throughout.

## Repository layout

```
packages/crypto   E2EE library (X3DH + Double Ratchet) — tested
packages/types    Shared Zod wire contract (server + client)
packages/config   Shared tsconfig / eslint presets
apps/server       Fastify API + Prisma (+ planned WS gateway)
apps/web          React client (dark, responsive)
infra             docker-compose: Postgres, Redis, MinIO
docs              Architecture, crypto, data model, API, security, roadmap
```

## Prerequisites

- **Node 20+** and **pnpm 9+**
- **Docker** (for Postgres, Redis, MinIO)

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment (generate strong secrets!)
cp .env.example .env
#    then set JWT_ACCESS_SECRET / JWT_REFRESH_SECRET, e.g. `openssl rand -base64 48`

# 3. Boot the whole stack with one command:
#    starts Docker Desktop if needed → infra (Postgres/Redis/MinIO) → migrations
#    → API (:4000) + web (:5173), with health checks at each step.
pnpm dev:all
```

> **Why `dev:all`?** If Docker Desktop quits in the background, Postgres/Redis/MinIO
> go down, the API dies, and the web client shows *"Could not reach the server."*
> `pnpm dev:all` preflights each dependency so that can't happen silently. To run
> the pieces individually instead:
>
> ```bash
> pnpm infra:up                            # Postgres + Redis + MinIO
> pnpm db:migrate                          # apply the database schema
> pnpm --filter @securechat/server dev     # API on http://localhost:4000
> pnpm --filter @securechat/web dev        # Web on http://localhost:5173
> ```

## Verify it works

```bash
# Crypto: X3DH + Double Ratchet round-trip tests
pnpm --filter @securechat/crypto test

# Server health
curl http://localhost:4000/health          # {"status":"ok",...}
curl http://localhost:4000/health/ready     # {"db":"up"} once infra is up

# Full registration end-to-end (generates real keys, writes to Postgres)
node apps/server/scripts/verify-register.mjs

# Full auth flow: register → me → login → refresh rotation → reuse detection → logout
node apps/server/scripts/verify-auth.mjs

# Two-user messaging: X3DH + Double Ratchet over the API + WebSocket, receipts,
# typing, bidirectional ratchet, history (server only ever sees ciphertext)
node apps/server/scripts/verify-messaging.mjs

# Encrypted attachments: per-file key → MinIO upload → recipient decrypt, with
# download authorization (non-members get 403)
node apps/server/scripts/verify-attachments.mjs

# Multi-device: 2 devices for one user sync; device list + revoke
node apps/server/scripts/verify-multidevice.mjs

# Group chats: per-member encrypted fan-out, admin roles, add/remove, non-member rejection
node apps/server/scripts/verify-groups.mjs

# Sealed sender: anonymous delivery (no sender stored), authorized by delivery token
node apps/server/scripts/verify-sealed.mjs

# Call signaling: offer/answer/ICE/end relayed to a peer (media stays P2P)
node apps/server/scripts/verify-calls.mjs

# Group-call mesh signaling + encrypted chat backup round-trip
node apps/server/scripts/verify-group-calls.mjs
node apps/server/scripts/verify-backup.mjs

# Profile editing: name/bio/username (409 on taken) + avatar upload & resolve
node apps/server/scripts/verify-profile.mjs

# Or run ALL end-to-end suites at once (server must be running):
pnpm test:e2e

# Optional: run an echo-bot user to chat with from the browser
node apps/server/scripts/bot-user.mjs   # prints BOT_USERNAME=... then auto-replies
```

## Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev:all` | Boot Docker + infra + migrations + API + web (one command) |
| `pnpm dev` | Run API + web only (assumes infra already up) |
| `pnpm test` | Run all package tests |
| `pnpm build` | Build everything (Turbo) |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm infra:up` / `pnpm infra:down` | Start / stop Docker services |
| `pnpm db:migrate` | Apply Prisma migrations |
| `pnpm db:generate` | Regenerate the Prisma client |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — topology, components, flows, scale model
- [Cryptography](docs/CRYPTO.md) — X3DH, Double Ratchet, multi-device, files
- [Data model](docs/DATA-MODEL.md) — schema, indexes, privacy invariant
- [API & realtime](docs/API.md) — REST + WebSocket protocol
- [Security](docs/SECURITY.md) — threat model and honest limitations
- [Production](docs/PRODUCTION.md) — deploy, scale, secrets, backups, checklist
- [Audit readiness](docs/AUDIT.md) — auditor orientation, questions, known limits
- [Roadmap](docs/ROADMAP.md) — what's built and what's next

## License

Proprietary — Copyright (c) 2026 Abhyudh Solanki. All rights reserved.
No use, copying, modification, or distribution is permitted without prior
written consent. See [LICENSE](LICENSE) for full terms and contact details.
# Secure-Chat
# Secure-Chat
