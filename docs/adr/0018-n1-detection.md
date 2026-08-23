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

**1. N+1 as an invariant, not a number.** For each hot path, run it against two very different data
volumes and assert the query count is _identical_:

```ts
const small = await withQueryCount(call, { seed: 10 })
const large = await withQueryCount(call, { seed: 1000 })
expect(large.count).toBe(small.count)
```

**2. Index usage proven by plan, against realistic volume.** `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)` on each hot query against a ~250k-row seed, asserting no sequential scan on large tables, that
the intended index is used, and that execution stays within budget.

## Why

A threshold assertion (`expect(queries).toBeLessThan(5)`) requires guessing a number, and the guess
is wrong the moment the query changes shape. The invariant needs no guess: an N+1 is _by definition_
a query count that grows with row count, so comparing two volumes detects it structurally and
reports a real number when it fails.

Plan assertions are the only way to detect a missing index, because a small table is seq-scanned
regardless of what indexes exist — so a small-seed latency budget proves nothing.

## Rejected

- **A `mitata` micro-benchmark suite.** Statistically rigorous, but it would measure `nextTarget()`
  and Zod parsing, which will never be this application's bottleneck. It answers a question we do
  not have.
- **Latency budgets in the normal test suite only.** Cheap and always-on, but with small seeds it
  passes while the production-relevant defect sits undetected — the exact failure the research
  describes.

## Consequences

- A deterministic large seed (`seed-perf.ts`, seeded PRNG so plans are reproducible) must be
  maintained alongside the schema.
- `bun run perf` takes minutes and is excluded from `bun run check`. It runs before releases and in CI.
- Results are written to `.artifacts/perf.md` so they can be read and diffed between runs.
- Complemented in production by `pg_stat_statements` and `auto_explain`, surfaced through the
  `db_slow_queries` MCP tool, so a stranger's slow instance can be diagnosed remotely.
