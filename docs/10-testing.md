# Testing

Four tiers. Each answers a different question, and putting an assertion in the wrong tier is how a
suite becomes slow, flaky, or quietly stops proving anything.

| Tier | Where | Answers | Cost |
| ---- | ----- | ------- | ---- |
| T1 contract | `packages/contract/**/*.test.ts` | Is the domain arithmetic right? | milliseconds |
| T2 integration | `apps/api/src/**/*.test.ts` | Does the API behave, and does it match the contract? | seconds |
| T3 UI | `apps/app/e2e/*.e2e.ts` | Does every route render without exploding? | seconds |
| T4 performance | `apps/api/src/test/perf/*.perf.ts` | Will this survive real data on cheap hardware? | minutes |

T1–T3 run in `bun run check`. **T4 does not** — it needs its own database at production volume.

## The rule that shapes all of it

**All behaviour is tested on the backend.** The UI holds no domain logic, so there is nothing in it
worth a behaviour test; every rule lives either in `@cedo/contract` (T1) or in a service (T2). This
is why T3 can be three assertions per route instead of a test suite of its own, and why the frontend
never needs a test dependency. See `docs/01-architecture.md`.

## T1 — contract

Pure functions, no database, no DOM: `nextTarget()`, the unit converters, `parseMediaUrl()`, and
every `.refine()` invariant such as muscle loads summing to 100. Most of the domain's correctness is
proven here, which is what makes the thinness rule affordable everywhere else.

`isomorphic.test.ts` additionally asserts the package imports nothing but `zod` — the dependency
boundary is a test, not a convention.

## T2 — API integration

One `*.test.ts` next to each `service.ts`, driven through `treaty(app)` so requests traverse the real
Elysia lifecycle: validation, the auth macro, the error handler. No socket, no port.

Two things are mandatory in every module:

- **Cross-user and cross-group ACL isolation.** A user must get `404`, never `403`, for something
  they cannot see — `403` confirms it exists.
- **`expectContract(Schema, res.body)` on every response**, read through `wire`, not through Treaty.
  Treaty revives ISO date strings into `Date` objects on the client; the real frontend uses plain
  `fetch` plus Zod and sees strings. Asserting against the revived value would drift the contract
  toward accepting `Date`, which would then break the actual client. See
  `docs/adr/0015-no-eden-treaty.md`.

### The database

`docker-compose.test.yml` runs a throwaway Postgres with `fsync=off` and a tmpfs volume. Under
`bun test --parallel` each worker gets its own database (`cedo_test_w3`), created on demand by
`ensureDatabaseExists`; migrations run once per worker, and every table except `muscles` is truncated
between tests. `TEST_DATABASE_URL` is a safety interlock: with `NODE_ENV=test`, `DATABASE_URL` is
ignored entirely, so a stray `bun test` cannot truncate a real instance.

## T3 — UI verification

Planned with the frontend (`docs/08-frontend.md`). Deliberately not behaviour tests: they check that
every route renders, that nothing throws, and what it looks like. Every e2e test fails automatically
on any console error, and always writes a screenshot the AI reads back. See
`docs/adr/0017-webview-for-ui-verification.md`.

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
integration harness never touches it.

### The three assertion classes, in order of what they are worth

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

### What the planner is allowed to decide

Not every sequential scan is a defect. On a small table it is the correct plan, and asserting against
it there would be cargo cult. `noSeqScan` therefore names tables explicitly, and only ones the seed
grows to production volume.

The search path is the clearest example: for a rare term Postgres uses the trigram index, and for a
common one it walks `exercises_name_id_idx` in order and stops at the page size. Both are correct, so
the hot path asserts only the absence of a sequential scan, and a separate test pins the trigram
index with a deliberately selective term — the case where it must earn its place.

### What this suite has already caught

- `GET /exercises` read all 11,000 visible rows and top-N sorted them **on every page**. The
  composite `(owner_group_id, name, id)` index cannot serve the default `scope=all`, where the filter
  is `owner_group_id in (…52 groups…)`: there is no plan that walks 52 index ranges in merged name
  order. Adding `exercises_name_id_idx` on `(name, id)` took it from 2.4ms and 332 buffers to 0.15ms
  and 48, and made it constant as the library grows.
- `GET /sessions` sorted every session a user owns on every page. Its index was `(user_id,
  started_at desc)` while the keyset cursor is a row comparison on `(started_at, id)` — the comment
  in the service claimed the two matched, and they did not. Adding `id` to the index fixed it.
- Both the media and favourites tables were empty in the first version of the seed, so their joins
  read `Seq Scan on media (rows=0)` — which looks like a pass and measures nothing.

### Adding a guard for a new endpoint

1. Add an entry to `HOT_PATHS` in `apps/api/src/test/perf/hot-paths.ts`: a `run(fixtures, size)`
   that calls the **service**, and the one `dimension` that differs between `small` and `large`.
2. If the endpoint reads something the seed does not populate, extend `seed-perf.ts`. An empty table
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
