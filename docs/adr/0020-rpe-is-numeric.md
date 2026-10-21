# 0020 — RPE is stored as `numeric(3,1)`, not as an integer

**Status:** Accepted (2026-10-21)

## Context

Invariant 6 stores every measurement as an integer in base units — `weight_g`, `distance_mm`,
`duration_s` — because a float drifts and a decimal kilogram invites conversions scattered across
the codebase. RPE was a whole number 1 to 10 in a `smallint`, and fitted without thought.

The requirements review (#3) made RPE 5 to 10 in **half-points**: people are asked it as reps in
reserve, and "one and a half left" is a real answer (Zourdos et al., JSCR 2016; Halperin et al.,
Sports Med 2022). A `smallint` cannot hold 8.5.

## Decision

`set_logs.rpe` and `workout_sets.target_rpe` are **`numeric(3,1)`**, read as numbers
(`db/tables/rpe.ts`), with a check holding the contract's scale — between `RPE_MIN` and `RPE_MAX`,
in steps of `RPE_STEP` — for any write that bypasses the contract.

RPE is a **rating**, not a measurement: it has no unit to convert, no base unit to be an integer
of, and no arithmetic is done on it beyond `RPE_MAX - rpe`. `numeric` is exact, so 8.5 is 8.5 and
the step check is exact too. Invariant 6 keeps its meaning; this is outside it.

## Rejected

**An integer count of half-points** (`smallint`, 10 to 20). It keeps every numeric column an
integer, at the price of a conversion on every read and write path — the session read, history,
the plan read and save, the perf seed, MCP — each a place to forget it, for a value that was never
a quantity. That is the scattered conversion invariant 6 exists to prevent, moved rather than
removed.

**`real`.** Inexact: 8.5 survives, but a check of the step on a float is the drift the invariant
warns about.
