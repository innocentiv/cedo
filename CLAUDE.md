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
5. **Every query against an ownable table must apply `visible()` or `editable()` — including
   JOINS.** Reading your own row does not entitle you to a name joined onto it, and visibility is
   not permanent: a member can be removed from a group after logging against its workouts. This has
   had to be fixed five times. See `docs/03-domain-model.md`.
6. **All measurements are stored as integers in base units** (`weight_g`, `distance_mm`,
   `duration_s`). Conversion happens only in `packages/contract/src/units.ts`.
7. **All behaviour is tested on the backend.** UI code stays trivially thin and holds no domain
   logic. See `docs/10-testing.md`.

## Commands

| Command | Use |
| --- | --- |
| `bun run check` | The gate. Run after every feature. |
| `bun run test:changed` | Inner loop — only tests affected by your diff. |
| `bun run db:reset` | Empty volume → migrate → seed, in one command. |
| `bun run db:test` | The throwaway Postgres the test suite needs. |
| `bun run shot <route>` | Rebuild, render a UI route, screenshot to `.artifacts/`, print console errors. |
| `bun run e2e` | Rebuild, then the full UI journeys; fails on any console error. Foreground only. |
| `bun run perf` | N+1 and missing-index guards against its own 250k-row database. Pre-release. |
| `bun run perf:report` | Writes `.artifacts/perf.md` — every hot path's query counts and full plans. |

## Working notes

Hard-won, and expensive to rediscover. Add to this list when something costs you a cycle.

- **Edit existing files with the `Edit` tool, not `sed`/`python` string replacement.** A string
  replacement that does not match is a *silent no-op*; `Edit` errors. This cost roughly ten silent
  failures in one session — several only surfaced later, as an unused import.
- **Format once, before `bun run check` — not after every write.** `oxfmt` rewrites the text your
  next edit is trying to match. `oxlint` and `tsc` do not care about formatting, so there is no
  feedback lost. Markdown is excluded from `oxfmt` entirely for the same reason.
- **`tsc -b` can report success while skipping files it considers up to date.** If a result looks
  too clean after adding files, re-run with `--force`.
- **Prove a regression test fails against the unfixed code.** One "passing" race test here was
  measured to false-pass one run in seven; it needed five rounds to be trustworthy.
- **Run `/code-review` at each milestone boundary, before building on top.** Two reviews in this
  session found 30 real defects between them, including an ACL invariant violation and a design flaw
  that would have broken every image in the UI.
- **Verify plans, not timings.** An index existing is not an index being used. `bun run perf` found
  two indexes that were never chosen by the planner, both of which looked correct in the schema.
- **A perf guard is worthless until you have watched it fail.** Drop the index against
  `cedo_test_perf`, or reintroduce the N+1, and confirm the message names the problem.
- **An empty table makes every assertion about it vacuous, and uniform data is nearly as bad.** The
  first perf seed left `media` and the favourites tables empty (`Seq Scan on media (rows=0)` — passes,
  proves nothing), and gave every muscle the same number of exercises, which made a real index look
  dead because the planner never had a selective case to use it on.
- **`bun test <dir>` matches only `*.test.*` / `*.spec.*` and exits 0 when it matches nothing.** The
  `perf` and `e2e` scripts pass explicit `./path/*.perf.ts` globs for this reason. "0 files were
  searched" is a broken script, not an empty suite.
- **Explicit `.ts` extensions defeat Metro's platform resolution.** `import './x.ts'` never picks
  `x.web.ts`. Branch on `Platform.OS` in one file instead — see `apps/app/src/auth/token-storage.ts`.
- **Read the screenshot, do not just check the test passed.** Four real bugs across M8 and M9 were
  green in every assertion and obvious in the PNG — including a numeric field that appended instead
  of replacing, which logged 88 reps for 8.
- **Grep the built bundle when a build-time substitution matters.** `process.env['EXPO_PUBLIC_X']`
  typechecks, lints and runs in dev, and is silently `undefined` in the shipped app.
- **Run the e2e suite in the foreground.** A backgrounded `bun run e2e` reported every journey as
  failed after seventeen minutes; the WebView needs the session it was started from.
- **`e2e` and `shot` serve `apps/app/dist`, so both rebuild first.** They used not to, which meant
  editing a screen and running either tested the PREVIOUS bundle and passed. Use `e2e:only` to skip
  the rebuild when you know the bundle is current.

## Documentation map

| File | Answers |
| --- | --- |
| `docs/00-overview.md` | What the product is, and what it deliberately is not |
| `docs/01-architecture.md` | Workspaces, the dependency rule, the request path |
| `docs/02-conventions.md` | Naming, file layout, errors, the rules above in detail |
| `docs/03-domain-model.md` | Tables, relations, invariants, indexes |
| `docs/04-contract.md` | How one schema reaches the DB, API, MCP and UI |
| `docs/05-database.md` | Drizzle patterns, migrations, seeding |
| `docs/06-api.md` | Route conventions, auth, pagination |
| `docs/07-mcp.md` | Tool conventions and client registration |
| `docs/08-frontend.md` | Expo router layout, UI primitives, the thinness rule |
| `docs/09-deployment.md` | Compose, Caddy, env, backup |
| `docs/10-testing.md` | The four test tiers and what belongs in each |
| `docs/adr/` | Why each decision was made, and what was rejected |
| `docs/playbooks/` | Step-by-step recipes — start here to add anything |

| Playbook | For |
| --- | --- |
| `docs/playbooks/add-entity.md` | A new entity, contract to screen. Start here. |
| `docs/playbooks/add-screen.md` | A new UI route |
| `docs/playbooks/add-mcp-tool.md` | A new MCP tool |
| `docs/playbooks/add-progression-rule.md` | A new progression kind |
| `docs/playbooks/diagnose-slow-instance.md` | "It is slow on my NAS" |

To add a new entity end to end, follow `docs/playbooks/add-entity.md` exactly.
