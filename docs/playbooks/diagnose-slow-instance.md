# Diagnosing someone else's slow instance

Someone reports that cedo is slow on their NAS. You have no shell on that box. This is the one
situation the diagnostics exist for — locally you have psql, the source and `bun run perf`.

Everything below is available two ways, over the same functions: the `platform_status` and
`db_slow_queries` MCP tools, and `GET /api/admin/status` and `GET /api/admin/slow-queries`. Both
require a **curator** — an editor of the seeded `cedo` group. See `docs/07-mcp.md`.

## 1. Ask what the instance actually is

`platform_status` returns row counts per table, installed extensions, migrations applied, database
size, and the planner settings.

Three things are usually the answer on their own:

- **`random_page_cost`.** If it is `4`, the planner is modelling a spinning disk and will refuse the
  trigram index on exercise search. The compose file sets `1.1`; a hand-rolled deployment often does
  not. Measured at 20k rows this is 5.96 ms against 0.077 ms.
- **`pg_stat_statements` missing from `extensions`.** No query statistics at all, and
  `db_slow_queries` will say so rather than returning nothing.
- **Row counts far outside what the perf suite covers.** `bun run perf` measures 250k set logs and
  10k exercises. Someone an order of magnitude past that is outside what has been proven.

## 2. Ask what is actually slow

`db_slow_queries` returns the worst statements by total execution time. They are **normalised** by
Postgres — parameters appear as `$1`, never literal values — so this cannot disclose a user's data.

Read total time, not mean. A 4 ms query run 90,000 times is the problem; a 900 ms query run twice is
not.

## 3. Reproduce it at volume, locally

Do not guess from the statement. Add the path to `HOT_PATHS` in
`apps/api/src/test/perf/hot-paths.ts` and run it against the seeded database:

```bash
bun run perf:report      # writes .artifacts/perf.md, with every plan
```

If it looks fine locally and slow there, the difference is data shape, not code. The most likely
cause is one the seed has already had to be corrected for twice: **their data is lopsided in a way
yours is not.** A uniform seed gives the planner no reason to choose a selective plan, and an empty
table makes every assertion about it vacuous. See `docs/10-testing.md`.

## 4. Fix it where it cannot regress

An index or a query change lands with a guard in the perf suite, and the guard is watched failing —
drop the index against `cedo_test_perf` and confirm the message names the problem. A guard nobody
has seen fail is not a guard.
