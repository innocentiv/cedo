# cedo

Self-hosted workout tracker. Bun + Elysia + Postgres backend, Expo (React Native for web, iOS,
Android) frontend, with an MCP server so an AI can operate every entity.

**Read `docs/01-architecture.md` before writing any code.** The conventions below are load-bearing;
breaking one produces a codebase that drifts from itself, which is the specific failure this project
is designed to prevent.

## Non-negotiable invariants

1. **`bun run check` must pass after every feature.** Format, lint (type-aware on the server),
   typecheck, and tests. Warnings fail. Never commit with it red.
2. **`packages/contract` is the only shared surface.** `apps/app` must NEVER import from `apps/api`
   — not even a type. This is enforced by lint, not just convention. See `docs/01-architecture.md`.
3. **Schemas are authored once, in Zod, in `packages/contract`.** The DB, HTTP routes, MCP tools and
   UI all derive from them. Never redeclare a shape.
4. **Business logic lives in `service.ts`.** Route handlers and MCP tools are ≤5 lines and both call
   the same service function. No logic in controllers.
5. **Every query against an ownable table must apply `visible()` or `editable()`.** Omitting it is a
   data leak between users. See `docs/03-domain-model.md`.
6. **All measurements are stored as integers in base units** (`weight_g`, `distance_mm`,
   `duration_s`). Conversion happens only in `packages/contract/src/units.ts`.
7. **All behaviour is tested on the backend.** UI code stays trivially thin and holds no domain
   logic. See `docs/10-testing.md`.

## Commands

| Command                | Use                                                                      |
| ---------------------- | ------------------------------------------------------------------------ |
| `bun run check`        | The gate. Run after every feature.                                       |
| `bun run test:changed` | Inner loop — only tests affected by your diff.                           |
| `bun run shot <route>` | Render a UI route, screenshot it to `.artifacts/`, print console errors. |
| `bun run e2e`          | Full UI journeys; fails on any console error.                            |
| `bun run perf`         | N+1 and missing-index guards against a large seed. Slow; pre-release.    |

## Documentation map

| File                      | Answers                                                |
| ------------------------- | ------------------------------------------------------ |
| `docs/00-overview.md`     | What the product is, and what it deliberately is not   |
| `docs/01-architecture.md` | Workspaces, the dependency rule, the request path      |
| `docs/02-conventions.md`  | Naming, file layout, errors, the rules above in detail |
| `docs/03-domain-model.md` | Tables, relations, invariants, indexes                 |
| `docs/04-contract.md`     | How one schema reaches the DB, API, MCP and UI         |
| `docs/05-database.md`     | Drizzle patterns, migrations, seeding                  |
| `docs/06-api.md`          | Route conventions, auth, pagination                    |
| `docs/07-mcp.md`          | Tool conventions and client registration               |
| `docs/08-frontend.md`     | Expo router layout, UI primitives, the thinness rule   |
| `docs/09-deployment.md`   | Compose, Caddy, env, backup                            |
| `docs/10-testing.md`      | The four test tiers and what belongs in each           |
| `docs/adr/`               | Why each decision was made, and what was rejected      |
| `docs/playbooks/`         | Step-by-step recipes — start here to add anything      |

To add a new entity end to end, follow `docs/playbooks/add-entity.md` exactly.
