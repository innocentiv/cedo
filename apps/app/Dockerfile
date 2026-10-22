# syntax=docker/dockerfile:1
#
# The web app: a static export served by Caddy, which also proxies /api. Built from the repository
# ROOT — it depends on `packages/contract` through the Bun workspace. See docs/09-deployment.md.

FROM oven/bun:1.4-alpine AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/contract/package.json packages/contract/
COPY apps/app/package.json apps/app/
COPY apps/api/package.json apps/api/
# `--filter` keeps the API's server-only tree out of the web build.
RUN bun install --frozen-lockfile --filter '@cedo/app' --filter '@cedo/contract'

COPY packages/contract packages/contract
COPY apps/app apps/app

# NO API URL is baked in. The app calls the relative path /api, which Caddy proxies, so this exact
# image works on any host at any port — which is the point when it is distributed to strangers.
WORKDIR /app/apps/app
# The static export, and the service worker that keeps it on an installed phone (src/pwa/).
RUN bun run export

FROM caddy:2-alpine AS runtime
COPY --from=build /app/apps/app/dist /srv
COPY apps/app/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
