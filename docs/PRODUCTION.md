# SecureChat — Production Deployment & Operations

> ⚠️ Do not run a real-world deployment until the cryptography has had an
> independent audit — see [AUDIT.md](./AUDIT.md).

## Build & run (containers)

Images are built from the repo root (the server needs the pnpm workspace):

```bash
# Server API
docker build -f apps/server/Dockerfile -t securechat-server .

# Web (Vite inlines the API URL at BUILD time)
docker build -f apps/web/Dockerfile \
  --build-arg VITE_API_URL=https://api.example.com \
  --build-arg VITE_WS_URL=wss://api.example.com/ws \
  -t securechat-web .
```

Or the whole stack:

```bash
cp .env.example .env   # set strong secrets, real S3, public URLs
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

The server container runs `prisma migrate deploy` on start, then boots the API.

## Required configuration

All config is validated at boot (`apps/server/src/config.ts`) — the process exits
on missing/invalid values. Generate secrets with `openssl rand -base64 48`.

| Variable | Notes |
|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥16 bytes; rotate periodically |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Presence + cross-instance pub/sub |
| `S3_*` | S3-compatible object storage for encrypted blobs |
| `WEB_ORIGIN` | Exact web origin (CORS + cookie scope) |
| `VITE_API_URL`, `VITE_WS_URL` | Baked into the web build |

## Topology & scaling

- **App servers are stateless** → scale horizontally behind a load balancer.
  Cross-instance realtime delivery goes through Redis pub/sub, so sticky sessions
  are NOT required.
- **Rate limiting**: in-memory per instance today (strict only in production —
  see `app.ts`). For multi-instance, back `@fastify/rate-limit` with the Redis store.
- **PostgreSQL**: add read replicas for history reads; time-partition the hot
  `MessageEnvelope`/`SealedMessage` tables; keyset pagination is already used.
- **Object storage**: clients upload/download encrypted blobs directly via presigned
  URLs, so file bandwidth never touches the app servers.
- **WebSocket**: terminate WSS at the LB; ensure idle timeouts exceed the 25s
  heartbeat.

## TLS, headers, cookies

- Terminate TLS at the edge; set `NODE_ENV=production` so `trustProxy`, secure
  cookies, and HSTS/CSP (via `@fastify/helmet`) are enabled.
- The refresh token is an httpOnly, `SameSite=strict`, Secure cookie scoped to
  `/auth`. The access token lives only in client memory.

## Observability

- `GET /health` (liveness), `GET /health/ready` (DB check) — wire to LB probes.
- `GET /metrics` — Prometheus text (uptime, RSS, request + 5xx counters). Expose
  only on the internal network; scrape with Prometheus.
- Every response carries `x-request-id`; logs are structured JSON (pino) in prod.
  Swap the metrics module for `prom-client` + OpenTelemetry tracing for full infra.

## Backups & data lifecycle

- Back up PostgreSQL regularly (ciphertext at rest is safe, but availability and
  receipts/membership are not). Snapshot object storage.
- Account deletion cascades (`onDelete: Cascade`) to devices, keys, envelopes,
  memberships, and sealed messages.
- Prune consumed one-time prekeys and delivered envelopes on a schedule; rotate
  signed prekeys.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, and build, plus an
end-to-end job that boots Postgres/Redis/MinIO service containers, applies
migrations, starts the server, and runs all `verify-*.mjs` suites
(`pnpm test:e2e`).

## Pre-launch checklist

- [ ] Independent cryptographic audit complete (see AUDIT.md).
- [ ] Strong, rotated secrets; secrets manager (not `.env`) in prod.
- [ ] TLS everywhere; security headers verified; CORS locked to the real origin.
- [ ] Redis-backed rate limiting; abuse/spam controls; account lockout policy.
- [ ] Backups + restore tested; monitoring + alerting wired.
- [ ] Load test (messaging fan-out, WS connections, prekey consumption).
- [ ] Privacy review of metadata exposure (see SECURITY.md §4).
