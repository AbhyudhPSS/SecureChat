# Build context is the REPO ROOT. Build with:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com \
#     --build-arg VITE_WS_URL=wss://api.example.com/ws -t securechat-web .
FROM node:20-slim AS build
RUN npm install -g pnpm@9.12.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @securechat/crypto --filter @securechat/types build
# Vite inlines these at build time, so they must be supplied as build args.
ARG VITE_API_URL
ARG VITE_WS_URL
RUN pnpm --filter @securechat/web build

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
