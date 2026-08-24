# Deployment

Three containers, **one published port**. Verified from a clean `docker compose up --build`.

```
                    :8080
                      │
                 ┌────▼─────┐
                 │   web    │  Caddy: static export + /api proxy
                 └────┬─────┘
                      │ api:3000  (not published)
                 ┌────▼─────┐
                 │   api    │  Bun + Elysia + MCP
                 └────┬─────┘
                      │ db:5432
                 ┌────▼─────┐
                 │    db    │  Postgres 18
                 └──────────┘
```

## Getting it running

```bash
cp .env.example .env          # then set POSTGRES_PASSWORD
docker compose up --build -d
curl -s localhost:8080/api/health          # {"ok":true,"db":true}
open http://localhost:8080                 # register, and you have a library
```

That is the whole install. Migrations and seeding run inside the API container before it binds, so a
container that is accepting traffic is one whose schema is current and whose library is present.
Both are idempotent, so this is also the upgrade path: `docker compose pull && docker compose up -d`
delivers new library entries without anyone running a command.

## Why one origin

The browser talks only to Caddy. `/api/*` is proxied to the API container; everything else is the
static export. Three things follow, and all of them matter for software handed to strangers:

- **No CORS anywhere.** Not a dependency, not a config block, no preflight on any mutation.
- **No API URL is baked into the build.** The app calls the relative path `/api`, so the same image
  works on any host at any port. Nothing about your NAS is compiled into it.
- **One port to open.** The API and the database are on the compose network only.

Native builds have no such proxy and must be told where the server is, with
`EXPO_PUBLIC_API_URL`. That has to be **dot access** in the source — see `docs/08-frontend.md`.

## The images

Both are built from the repository **root**, because each depends on `packages/contract` through the
Bun workspace: the two are one install.

Every workspace manifest is copied so the lockfile matches exactly and `--frozen-lockfile` holds,
but `bun install --filter` installs only the members that image runs. The API image does not carry
the frontend's Expo tree, which is hundreds of megabytes it has no use for.

| Image | Base | Size |
| --- | --- | --- |
| `cedo-api` | `oven/bun:1.4-alpine` | ~152 MB |
| `cedo-web` | `caddy:2-alpine` | ~63 MB |

One trap worth knowing: Bun workspaces put a `node_modules` symlink directory **inside each member**
as well as in the root store. Copying only `/app/node_modules` produced a container that started and
then failed every import with "Cannot find package 'elysia'".

## Configuration

`.env` is read by compose. `apps/api/src/env.ts` validates the result with Zod and **refuses to
boot** if anything is missing or malformed, so a misconfigured instance fails immediately with a
readable message rather than throwing something obscure on the first request.

| Variable | Notes |
| --- | --- |
| `POSTGRES_PASSWORD` | Required. Compose refuses to start without it. |
| `POSTGRES_USER`, `POSTGRES_DB` | Default to `cedo`. |
| `WEB_PORT` | Host port. Default 8080. |
| `CEDO_ADMIN_USERNAME` | Promoted to curator of the shared library on every seed run. Register the account first, then restart. Leave unset for a personal instance. |

`DATABASE_URL` is **composed inside `docker-compose.yml`**, not read from `.env`. The host inside the
network is always the service name, and a `DATABASE_URL` left pointing at `localhost` — the value a
developer needs — would otherwise silently break the deployment.

## Postgres settings that are not defaults

```
-c shared_preload_libraries=pg_stat_statements,auto_explain
-c random_page_cost=1.1
```

`pg_stat_statements` and `auto_explain` are what make a stranger's slow instance diagnosable with no
shell: `GET /api/admin/slow-queries` and the `db_slow_queries` MCP tool read them. Statements are
normalised by the extension, so no user data is exposed. See `docs/06-api.md`.

`random_page_cost` matters more than it looks. The default of 4 models a spinning disk; every machine
this realistically runs on has SSD or NVMe, and at the default the planner refuses the trigram index
on exercise search and scans instead — measured at 20k rows, 5.96 ms / 354 buffers against 0.077 ms /
17 buffers. See `docs/05-database.md`.

The data volume is mounted at `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`. Postgres 18
keeps the cluster in a version subdirectory so `pg_upgrade --link` works across major versions; the
deeper mount point puts a filesystem boundary in the way and makes a future upgrade painful for
everyone self-hosting.

## Backup and restore

Two volumes hold everything: `pgdata` and `uploads`.

```bash
# Backup
docker compose exec -T db pg_dump -U cedo -Fc cedo > cedo-$(date +%F).dump
docker run --rm -v cedo_uploads:/data -v "$PWD":/out alpine \
  tar czf /out/cedo-uploads-$(date +%F).tar.gz -C /data .

# Restore, into an empty instance
docker compose up -d db
docker compose exec -T db pg_restore -U cedo -d cedo --clean --if-exists < cedo-2026-08-24.dump
docker run --rm -v cedo_uploads:/data -v "$PWD":/in alpine \
  tar xzf /in/cedo-uploads-2026-08-24.tar.gz -C /data
docker compose up -d
```

A dump is enough on its own if no media has been uploaded — YouTube links live in the database.

## TrueNAS Scale

Add it as a **Custom App** from this `docker-compose.yml`, or run it from a dataset over SSH. Two
notes specific to that box:

- Point the two volumes at datasets you already snapshot, rather than anonymous docker volumes.
- The default `POSTGRES_PORT` mapping in `docker-compose.yml` exists for local development. Delete
  that block on a shared machine; nothing outside the compose network needs the database.

## Checking a deployment

```bash
curl -s localhost:8080/api/health                       # {"ok":true,"db":true}
curl -s localhost:8080/api/openapi                      # the Scalar UI, generated from the contract
open http://localhost:8080                              # register, browse, build, log
```

MCP arrives on the same port. Mint a token in Settings, then:

```bash
claude mcp add --transport http cedo http://localhost:8080/api/mcp \
  --header "Authorization: Bearer <token>"
```

The check worth doing by hand, because it is the invariant everything else rests on: register a
second user and confirm they see the seeded library but **not** the first user's personal exercises,
and get `404` rather than `403` when they ask for one by id.
