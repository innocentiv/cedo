# 0018 — N+1 detected by query-count invariant, not a threshold

**Status:** Accepted (2026-08-23)

## Context

cedo is distributed free to many people running it on modest hardware. The database will never be
scaled, sharded or replicated. The two realistic performance failures are **accidental N+1 queries**
and **missing indexes** — not CPU-bound application code.

The standard advice fails for a specific reason, well put in the research:

> The missing index problem is invisible during development because test databases have few rows — a
> sequential scan on 500 rows takes microseconds, tests pass, and the problem appears when real data
> volumes meet real concurrency.

## Decision

Two mechanisms, both in a separate `bun run perf` suite (not the inner loop):

**1. N+1 as an invariant, not a number.** Every hot path declares the ONE dimension along which an
N+1 would grow — page size, plan size, history depth, group count — and is run at both ends of it.
The query count must be identical:

```ts
const small = await withQueryCount(() => path.run(fixtures, 'small'))
const large = await withQueryCount(() => path.run(fixtures, 'large'))
expect(large.count).toBe(small.count)
```

The two ends are two fixture profiles seeded to differ in that dimension and in nothing else
(`perf_small` has a 3-entry plan and 3 group memberships; `perf_large` has 560 entries and 52), so a
difference in query count can only have come from the dimension itself.

**2. Index usage proven by plan, against realistic volume.** `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)` on the statements a service **actually issued** — captured by the query recorder in
`db/client.ts` rather than re-typed into the test — asserting no sequential scan on the tables the
seed grows large, that the intended indexes appear, and that execution stays within a ceiling.

Explaining the recorded statement rather than a lookalike matters: a hand-copied query drifts the
moment the service changes, and then cheerfully asserts that an index is used by a query nobody runs.

## Why

A threshold assertion (`expect(queries).toBeLessThan(5)`) requires guessing a number, and the guess
is wrong the moment the query changes shape. The invariant needs no guess: an N+1 is _by definition_
a query count that grows with row count, so comparing two volumes detects it structurally and
reports a real number when it fails.

Plan assertions are the only way to detect a missing index, because a small table is seq-scanned
regardless of what indexes exist — so a small-seed latency budget proves nothing.

## Rejected

- **A `mitata` micro-benchmark suite.** Statistically rigorous, but it would measure `progress()`
  and Zod parsing, which will never be this application's bottleneck. It answers a question we do
  not have.
- **Latency budgets in the normal test suite only.** Cheap and always-on, but with small seeds it
  passes while the production-relevant defect sits undetected — the exact failure the research
  describes.

## Consequences

- A deterministic large seed (`db/seed-perf/`) must be maintained alongside the schema. Every value
  is derived arithmetically from a row number — not even a seeded PRNG — so two runs produce
  byte-identical data and a plan that changed did so because the code changed.
- **An empty table makes every assertion about it vacuous.** The first version of the seed left
  `media` and the favourites tables empty, and their joins read `Seq Scan on media (rows=0)`, which
  passes and proves nothing. A new hot path must extend the seed before it can be guarded.
- **Not every sequential scan is a defect**, so `noSeqScan` names tables explicitly. Where more than
  one plan is legitimately correct — the search path, where the planner rightly switches between the
  trigram index and an ordered walk depending on selectivity — pinning one would assert a planner
  choice rather than a property of the schema.
- `bun run perf` is excluded from `bun run check`. The seed takes about 30 seconds on first run and
  is then reused, so the gate itself runs in about a second.
- Results are written to `.artifacts/perf.md` so they can be read and diffed between runs.
- Complemented in production by `pg_stat_statements` and `auto_explain`, surfaced through the
  `db_slow_queries` MCP tool, so a stranger's slow instance can be diagnosed remotely.
