# Build context is the REPO ROOT (the server needs the pnpm workspace + shared
# packages). Build with:  docker build -f apps/server/Dockerfile -t securechat-server .
FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@9.12.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @securechat/crypto --filter @securechat/types build \
  && pnpm --filter @securechat/server exec prisma generate \
  && pnpm --filter @securechat/server build

# Runtime: reuse the built workspace (symlinked workspace deps + generated Prisma
# client + applied libsodium patch all resolve correctly). Pruning to a slimmer
# image via `pnpm deploy` is a noted optimization.
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/server
EXPOSE 4000
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]
