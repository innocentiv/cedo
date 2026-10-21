# Architecture

## The dependency rule

This is the single most important structural fact about the codebase:

```
                packages/contract
                 (Zod schemas +
                pure domain logic)
                    ^        ^
                    |        |
            apps/api          apps/app
      (Elysia, Drizzle,      (Expo: web today,
       services, MCP)         native later)

              apps/app  --X-->  apps/api
                   NEVER, not even a type
```

`apps/app` and `apps/api` never import each other. They agree because they both derive from
`packages/contract`, and the API proves it does so on every response (`expectContract`, see
`docs/10-testing.md`) while the client verifies it at runtime (`ContractDriftError`, see
`docs/04-contract.md`).

**Why it matters.** The frontend and backend dependency trees diverge sharply — Expo/Metro/React
Native on one side, Drizzle/Postgres/MCP on the other. A type-level import across that line couples
their build graphs, their TypeScript versions, and their upgrade schedules. It also creates a lock:
the frontend cannot type-check unless the entire backend compiles.

**Enforcement.** `apps/app/.oxlintrc.json` sets `no-restricted-imports` on `@cedo/api`. Violating
the rule fails `bun run lint`, not code review.

This is why we do not use Eden Treaty, despite it being Elysia's headline feature. See
`docs/adr/0015-no-eden-treaty.md`.

## Workspaces

| Workspace | Runtime | TypeScript | Purpose |
| --- | --- | --- | --- |
| `packages/contract` | any | 7.0.2 | Zod schemas, units, pure domain functions, and what each read is built from. Only dependency: `zod`. |
| `apps/api` | Bun | 7.0.2 | Elysia HTTP API, Drizzle/Postgres, MCP server. |
| `apps/app` | Expo | 6.0.3 | React Native, built for web. Native builds are not configured yet (#10). |

The TypeScript split is forced: type-aware linting requires TypeScript 7, and Expo will not support
it until 7.1. See `docs/adr/0007-typescript-version-split.md`.

## The request path

```
browser / native app
   |
   |  fetch('/api/exercises')            same origin — no CORS anywhere
   v
Caddy  (apps/app container)
   |  /api/*  -> strip prefix, reverse_proxy api:3000
   |  /*      -> static Expo web export, SPA fallback
   v
Elysia (apps/api container)
   |
   |  onError ................ maps domain errors to the { error: { code, message } } envelope
   |  auth macro ............. one query: session + user + group memberships
   |  route handler .......... <=5 lines: validate, call the service, return
   v
Service  (modules/<name>/service.ts)  <-- ALL business logic lives here
   |       reads through db/visible.ts; writes through modules/<name>/write*.ts
   v
Drizzle -> Postgres
```

## Why MCP lives inside the API

The MCP TypeScript SDK v2 exposes `createMcpHandler()`, which returns a standard
`fetch(Request) => Response`. Elysia is fetch-native and can `.mount()` it directly.

So `/mcp` is a route on the same server, sharing the same services, the same ACL, and the same
process. There is no second image, no second deployment, and no possibility of the MCP tools and the
HTTP routes disagreeing about a business rule — they call the same functions.

Authentication is verified by Elysia _before_ the handler runs, and the resulting principal is passed
in as `authInfo`, which is exactly the contract the SDK expects. See `docs/07-mcp.md`.

## Deployment shape

Three containers, one published port.

```
db    postgres:18-alpine    pgdata volume     (+ pg_stat_statements, auto_explain)
api   oven/bun:1.4-alpine   uploads volume    exposed to the compose network only
web   caddy:2-alpine        :8080 -> :80      static export + /api reverse proxy
```

Because the web bundle calls the relative path `/api`, nothing about the deployment host is baked
into the image. The same build runs on any machine, at any hostname or port — which matters when the
app is distributed to strangers. See `docs/09-deployment.md`.
