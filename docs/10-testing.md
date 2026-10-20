# Testing

Four tiers. Each answers a different question, and putting an assertion in the wrong tier is how a
suite becomes slow, flaky, or quietly stops proving anything.

| Tier | Where | Answers | Cost |
| ---- | ----- | ------- | ---- |
| T1 contract | `packages/contract/**/*.test.ts` | Is the domain arithmetic right? | milliseconds |
| T2 integration | `apps/api/src/**/*.test.ts` | Does the API behave, and does it match the contract? | seconds |
| T3 UI | `apps/app/e2e/*.e2e.ts` | Does every route render without exploding? | seconds |
| T4 performance | `apps/api/src/test/perf/*.perf.ts` | Will this survive real data on cheap hardware? | minutes |

T1 and T2 run in `bun run check`. **T3 and T4 do not**: `bun run e2e` builds the web bundle and
drives a real WebView, and `bun run perf` needs its own database at production volume. Run `e2e`
after any change under `apps/app`, and `perf` before a release or after touching a query or index.

## The rule that shapes all of it

**All behaviour is tested on the backend.** The UI holds no domain logic, so there is nothing in it
worth a behaviour test; every rule lives either in `@cedo/contract` (T1) or in a service (T2). This
is why T3 can be three assertions per route instead of a test suite of its own, and why the frontend
never needs a test dependency. See `docs/01-architecture.md`.

## T1 — contract

Pure functions, no database, no DOM: `nextTarget()`, the unit converters, `parseMediaUrl()`, and
every `.refine()` invariant such as muscle loads summing to 100. Most of the domain's correctness is
proven here, which is what makes the thinness rule affordable everywhere else.

So is a numeric field's editing (`editField`, in `typing.ts`): what stays on screen while a number
is typed, and when it gives way to the parent's value. `typing.test.ts` drives it key by key, as
the screen does, in milliseconds — including the case on native where the value changes under a
focused field, which no e2e journey can reach.

`isomorphic.test.ts` additionally asserts the package imports nothing but `zod` — the dependency
boundary is a test, not a convention.

## T2 — API integration

One `*.test.ts` next to each `service.ts` (a service whose only entry point is another module's
route — `progression`, reached through `GET /workouts/:id/progression` — is tested there), driven
through `treaty(app)` so requests traverse the real
Elysia lifecycle: validation, the auth macro, the error handler. No socket, no port.

A service's PURE half — rows in, answer out, like `progression/evaluate.ts` or `group/slug.ts` — is
tested directly beside it, with no database. It is still the service's rule, kept in the API because
only the API runs it; the contract is for what more than one side needs.

Two things are mandatory in every module:

- **Cross-user and cross-group ACL isolation.** A user must get `404`, never `403`, for something
  they cannot see — `403` confirms it exists. For an ownable kind, its entry in the shared
  ownable suite (below) is that proof; its own test file adds isolation only for what is its own.
- **`expectContract(Schema, res.body)` on every response**, read through `wire`, not through Treaty.
  Treaty revives ISO date strings into `Date` objects on the client; the real frontend uses plain
  `fetch` plus Zod and sees strings. Asserting against the revived value would drift the contract
  toward accepting `Date`, which would then break the actual client. See
  `docs/adr/0015-no-eden-treaty.md`.

Three suites guard what every module must share, and each fails rather than skips when something
new is not covered. See `docs/adr/0019-visible-relations.md`.

- **`test/membership-lost.test.ts`** — a member is removed through the real route, then every GET
  route and every read-only MCP tool is read as them. It enumerates the routes off the app and the
  tools off `tools/list`, so a new read path without a case fails it. Each case also declares
  whether it named the group's things while the caller was a member, so "shows nothing afterwards"
  cannot pass because it never showed anything.
- **`modules/ownable/ownable.test.ts`** — what every ownable must do identically (access, scopes,
  search escaping, keyset paging, favourites, transfer, duplicate), run once per kind in `KINDS`. It
  reads every `ownable()` table off the schema and fails when one has no entry; the per-kind test
  files keep only what is the kind's own.
- **`db/raw-sql.test.ts`** — scans every `sql` template outside `db/`, `write*.ts`, tests and the
  diagnostics exemption, and fails on the name of an owned table. It is the hole lint cannot see: a
  correlated subquery against a raw table needs no import.

### The database

`docker-compose.test.yml` runs a throwaway Postgres with `fsync=off` and a tmpfs volume. Under
`bun test --parallel` each worker gets its own database (`cedo_test_w3`), created on demand by
`ensureDatabaseExists`; migrations run once per worker, and every table except `muscles` is truncated
between tests. `TEST_DATABASE_URL` is a safety interlock: with `NODE_ENV=test`, `DATABASE_URL` is
ignored entirely, so a stray `bun test` cannot truncate a real instance.

## Why the perf and e2e files are named `.perf.ts` and `.e2e.ts`

`bun test` only collects files with `.test.`, `_test_`, `.spec.` or `_spec_` in the name, so neither
tier is picked up by a bare `bun test` — which is exactly what is wanted: both need infrastructure
that `bun run check` must not require.

The corollary is a trap. `bun test apps/app/e2e` matches nothing and **exits 0**, reporting success
for a suite it never ran. Both scripts therefore pass explicit paths beginning with `./`, which bun
treats as files rather than filters:

```jsonc
"perf": "CEDO_PERF=1 bun test ./apps/api/src/test/perf/*.perf.ts",
"e2e":  "bun run build:app && bun test ./apps/app/e2e/*.e2e.ts"
```

If either ever prints "0 files were searched", the glob is wrong — not the suite empty.

`e2e` and `shot` **rebuild the web bundle first**, because both serve `apps/app/dist`. Without that,
editing a screen and running either one tests the previous bundle and passes. `e2e:only` skips the
rebuild when the bundle is known to be current. And run e2e in the FOREGROUND: backgrounded, the
WebView loses the session it was started from and every journey fails after several minutes.

## T3 — UI verification

Planned with the frontend (`docs/08-frontend.md`). Deliberately not behaviour tests: they check that
every route renders, that nothing throws, and what it looks like. Every e2e test fails automatically
on any console error, and always writes a screenshot the AI reads back. See
`docs/adr/0017-webview-for-ui-verification.md`.

A journey that needs data the UI does not make — a second person, sixty exercises — sets it up from
the test process with the app's own client: `page.client()` to act as the page's user,
`signUp(name)` for anyone else. Typed and parsed by the contract, and awaited, so a fixture has
finished when it returns. Never a `fetch` evaluated inside the page: untyped, ids spliced into
strings, and easily fired without being awaited.

A journey drives the app through **screen drivers** (`apps/app/e2e/screens/`, gathered by
`screens(page)`): a driver per screen, grouped by area, each owning that screen's test ids and
waits, so a journey says what a person does — `app.session.entry(0).log()` — and asserts what they
see. Among the drivers a test id lives in exactly one: renamed, it breaks one line, not every
journey that passes through the screen. (The route sweep is the exception by design — a table of
routes and the screen each shows.) `e2e/journeys.test.ts` fails if a journey touches an element
itself; it may still navigate (`goto`), wait (`until`), type into what has focus (`keys`, `press`)
and set up data (`client`). A driver's wait is for what the person would see: a form that saved is
no longer SHOWN, but it is still in the page — a tab keeps its stack mounted — and the same goes for
counting rows.

## T4 — performance

```bash
bun run db:test        # once, starts the throwaway Postgres
bun run perf           # the gate: seeds on first run, then ~1s
bun run perf:report    # writes .artifacts/perf.md with every plan
bun run perf:seed      # force a rebuild of the perf database
```

### Why it exists

Two failures will hurt a self-hosted instance, and neither is application code: an accidental N+1,
and an index the planner does not use. Both are invisible at development volume, which is the whole
problem — a sequential scan over 500 rows takes microseconds and every test passes.

So T4 runs against its own database (`cedo_test_perf`, selected by `CEDO_PERF=1`) holding 250,000
set logs, 10,000 shared exercises, 1,000 plans and 5,000 sessions. It is seeded once and reused; the
integration harness never touches it. "Seeded" means the seed FINISHED: its last step writes a
marker (`perf_seed_completed`) and its first removes it, so a seed interrupted part way is rebuilt
rather than reused — a half-built library once failed the trigram guards for want of rows.

It is seeded into the state it would SETTLE in, not the one a bulk load leaves: the seed ends with
`VACUUM ANALYZE`, and the suite counts — read-only, through `pgstattuple`, before measuring anything —
the pages GIN indexes still hold pending, and fails if there are any. A timing measured against a
pending list describes nothing (see `docs/05-database.md`). None can be pending today, since every GIN
index is `fastupdate = off`; the check guards the seed and the next index.

### The assertion classes, in order of what they are worth

**1. Query count is identical at two volumes.** This is the N+1 detector and it is structural — it
holds or it does not, on any machine. Each hot path declares the one dimension that would grow an
N+1 (page size, plan size, history depth, group count) and is run at both ends of it. A threshold
(`expect(count).toBeLessThan(8)`) needs a guessed number, and the guess is wrong the moment the query
changes shape. See `docs/adr/0018-n1-detection.md`.

**2. The plan uses the intended index and scans nothing large sequentially.** An index that exists
but that the planner rejects looks identical in the schema, identical in a code review, and identical
in a fast test on 500 rows. The suite `EXPLAIN`s the statements a service **actually issued** —
captured by the query recorder in `db/client.ts`, not re-typed — so an assertion cannot drift away
from the code it is guarding.

**3. The slowest statement is under a budget.** Weakest of the three, because it is machine
dependent. The budgets are ceilings that catch a dropped index, not targets.

**4. A paginated path reads in index order, without a Sort.** `ordered` names the tables a list must
walk in `ORDER BY` order so `LIMIT` stops at the page size. An index whose order does not match the
query is still *used* — to find the rows — and then every matching row is sorted to return one page,
so assertion 2 passes over exactly the cost the index was added to remove.

A reused perf database is **migrated** on every run, so a migration that changes an index is
measured against the new schema, not the one the database was seeded with.

### What the planner is allowed to decide

Not every sequential scan is a defect. On a small table it is the correct plan, and asserting against
it there would be cargo cult. `noSeqScan` therefore names tables explicitly, and only ones the seed
grows to production volume.

The search path is the clearest example: for a rare term Postgres uses the trigram index, and for a
common one it walks `exercises_name_id_idx` in order and stops at the page size. Both are correct, so
the hot path asserts only the absence of a sequential scan, and a separate test pins the trigram
index with a deliberately selective term — the case where it must earn its place. The muscle filter
has the same shape, and the same pair of tests.

The corollary is a rule about seed data: **make it as lopsided as the real thing.** Uniform data
gives the planner no reason to choose the selective plan, so the index that exists for exactly that
case is never exercised and looks like dead weight.

### What this suite has already caught

- `GET /exercises` read all 11,000 visible rows and top-N sorted them **on every page**. The
  composite `(owner_group_id, name, id)` index cannot serve the default `scope=all`, where the filter
  is `owner_group_id in (…52 groups…)`: there is no plan that walks 52 index ranges in merged name
  order. Adding `exercises_name_id_idx` on `(name, id)` took it from 2.4ms and 332 buffers to 0.15ms
  and 48, and made it constant as the library grows.
- `GET /sessions` sorted every session a user owns on every page. Its index was `(user_id,
  started_at desc)` while the keyset cursor is a row comparison on `(started_at, id)` — the comment
  in the service claimed the two matched, and they did not. Adding `id` to the index was believed
  to fix it, and **did not**: Drizzle's `.desc()` builds `DESC NULLS LAST`, the query's `DESC`
  means `NULLS FIRST`, and the planner used the index to find the rows and then sorted all of them
  anyway. Nothing failed, because "the index is used" was true. That is why assertion 4 exists, and
  why the index is now `.desc().nullsFirst()`.
- Both the media and favourites tables were empty in the first version of the seed, so their joins
  read `Seq Scan on media (rows=0)` — which looks like a pass and measures nothing.
- `exercise_muscles_muscle_idx` appeared to be dead: zero scans across every guarded path, which
  would have made it pure write cost on every exercise write. It was the SEED that was wrong. The
  first version gave every muscle the same number of exercises, and with no rare muscle the planner
  never had a reason to enter through it. Skewing the library the way a real one is skewed —
  hundreds of chest movements, a handful for the adductors — the planner picks it immediately and
  reads 68 rows instead of walking the library. Uniform test data hides the only case an index
  exists for.

### Adding a guard for a new endpoint

1. Add an entry to `HOT_PATHS` in `apps/api/src/test/perf/hot-paths.ts`: a `run(fixtures, size)`
   that calls the **service**, and the one `dimension` that differs between `small` and `large`.
2. If the endpoint reads something the seed does not populate, extend `db/seed-perf/`. An empty table
   makes every assertion about it vacuous.
3. Run `bun run perf:report` and read `.artifacts/perf.md`. Fill in `noSeqScan` and `indexes` from
   the plans you actually see — never from what you assume the planner will do.
4. **Prove the guard fails.** Drop the index (`drop index …` against `cedo_test_perf`) or reintroduce
   the N+1, run `bun run perf`, and confirm it goes red with a message that names the problem. A
   guard that has never failed is a guard nobody has tested.

### In production

`pg_stat_statements` and `auto_explain` are enabled by container flags — no application code — and
surfaced by `GET /admin/status` and `GET /admin/slow-queries`, and by the `platform_status` and
`db_slow_queries` MCP tools. Both surfaces call the same functions, so a stranger's slow instance can
be diagnosed remotely and the AI sees exactly what a person would. Statements are normalised by the
extension (`$1` placeholders, never literal values), so this cannot disclose anyone's data.

## Commands

```bash
bun run test:changed   # inner loop
bun run check          # format, lint, typecheck, doc links, T1 + T2
bun run perf           # T4, before a release
```
