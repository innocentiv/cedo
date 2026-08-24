# syntax=docker/dockerfile:1
#
# The API. Built from the repository ROOT, because it depends on `packages/contract` through the
# Bun workspace — the two are one install. See docs/09-deployment.md.

FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
# Only the manifests, so a source-only change does not reinstall anything.
COPY package.json bun.lock bunfig.toml ./
COPY packages/contract/package.json packages/contract/
COPY apps/api/package.json apps/api/
COPY apps/app/package.json apps/app/
# Every workspace manifest is present so the lockfile matches exactly and the build is reproducible,
# but `--filter` installs only what this image runs — the frontend's Expo tree is hundreds of
# megabytes the API has no use for.
RUN bun install --frozen-lockfile --production --filter '@cedo/api' --filter '@cedo/contract'

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# All three trees. Bun workspaces put a symlink directory inside each member as well as the root
# store, and copying only the root leaves every import unresolvable at runtime.
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=deps /app/packages/contract/node_modules packages/contract/node_modules
COPY package.json bunfig.toml ./
COPY packages/contract/package.json packages/contract/
COPY packages/contract/src packages/contract/src
COPY apps/api apps/api

# Uploaded media lives on a volume; the directory has to exist and be writable by the runtime user.
RUN mkdir -p /data/uploads && chown -R bun:bun /data
USER bun

EXPOSE 3000

# `index.ts` migrates and seeds before it binds, so a container accepting traffic is a container
# whose schema is current. Both are idempotent and safe on every restart.
CMD ["bun", "run", "apps/api/src/index.ts"]
