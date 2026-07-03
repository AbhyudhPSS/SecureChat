#!/usr/bin/env bash
#
# dev-all.sh — one command to boot the whole local stack:
#   Docker daemon  →  infra (Postgres/Redis/MinIO)  →  DB schema  →  API + web
#
# Why this exists: Docker Desktop quitting in the background silently takes down
# Postgres/Redis/MinIO, which kills the API server, which makes the web client
# show "Could not reach the server." This script makes that state unrecoverable
# by preflighting each dependency before starting the dev servers.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="infra/docker-compose.yml"
info() { printf "\033[36m▸ %s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$1"; }
warn() { printf "\033[33m! %s\033[0m\n" "$1"; }

# 1. Docker daemon ----------------------------------------------------------
if docker info >/dev/null 2>&1; then
  ok "Docker daemon already running"
else
  info "Docker daemon not running — launching Docker Desktop…"
  open -a Docker 2>/dev/null || { warn "Couldn't launch Docker Desktop — start Docker manually, then re-run."; exit 1; }
  printf "  waiting for daemon"
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then printf "\n"; ok "Docker daemon ready"; break; fi
    printf "."; sleep 2
    [ "$i" -eq 60 ] && { printf "\n"; warn "Docker daemon didn't come up in 120s."; exit 1; }
  done
fi

# 2. Infra (Postgres / Redis / MinIO) --------------------------------------
info "Bringing up infra (Postgres, Redis, MinIO)…"
docker compose -f "$COMPOSE" up -d

printf "  waiting for services to be healthy"
for i in $(seq 1 60); do
  pg=$(docker inspect -f '{{.State.Health.Status}}' securechat-postgres-1 2>/dev/null || echo none)
  rd=$(docker inspect -f '{{.State.Health.Status}}' securechat-redis-1    2>/dev/null || echo none)
  mn=$(docker inspect -f '{{.State.Health.Status}}' securechat-minio-1    2>/dev/null || echo none)
  if [ "$pg" = healthy ] && [ "$rd" = healthy ] && [ "$mn" = healthy ]; then
    printf "\n"; ok "Infra healthy (postgres, redis, minio)"; break
  fi
  printf "."; sleep 1
  [ "$i" -eq 60 ] && { printf "\n"; warn "Infra not fully healthy (pg=$pg redis=$rd minio=$mn) — continuing anyway."; }
done

# 3. Database schema (idempotent — safe to run every boot) ------------------
# Prisma runs inside apps/server but DATABASE_URL lives in the repo-root .env,
# so pass it through explicitly (stripping any surrounding quotes).
info "Applying database migrations…"
DB_URL="$(grep -E '^DATABASE_URL=' .env 2>/dev/null | head -1 | sed -E 's/^DATABASE_URL=//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/')"
if [ -n "$DB_URL" ] && DATABASE_URL="$DB_URL" pnpm --filter @securechat/server exec prisma migrate deploy >/dev/null 2>&1; then
  ok "Database schema up to date"
else
  warn "Could not apply migrations automatically — if login fails, run: pnpm db:migrate"
fi

# 4. Clear stale dev servers on our ports ----------------------------------
# Prevents "port already in use" failures (web uses strictPort) from a previous
# run that didn't shut down cleanly.
for port in 4000 5173; do
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    warn "Port $port busy — stopping stale process(es): $pids"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
done

# 5. API (:4000) + web (:5173) together ------------------------------------
# turbo runs the persistent 'dev' task in both apps concurrently with merged output.
info "Starting API (http://localhost:4000) + web (http://localhost:5173)…"
echo
exec pnpm exec turbo run dev
