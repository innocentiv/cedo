# 0019 — Visibility is a relation modules join, not a predicate they remember

**Status:** Accepted (2026-10-16)

## Context

Invariant 5 — every query against an ownable table applies `visible()` or `editable()`, joins
included — had been fixed five times. Each fix was correct; the shape that produced them was not.
`visible()` was a predicate every author had to place by hand, in the right clause, on every join.
The raw tables could be imported anywhere, so a missing predicate failed no build and no test except
a scenario someone had thought to write. The misses fell into three shapes:

- a join onto an ownable table with no predicate (the session list naming a lost workout);
- a correlated subquery, which is a join no predicate is watching (`dayBalance`);
- a child read trusted because some earlier statement had checked its parent (five of these:
  days, entries and sets of a workout; an exercise's muscles and media).

## Decision

**Visible relations.** `db/visible.ts` exposes, per owned table, the rows a caller may read as an
aliased subquery — `visibleExercises(caller)`, `visibleWorkouts(caller)`, `visibleWorkoutDays(…)`
and so on. Read paths select from and join these; there is no raw table left to join by mistake. The
two cases in `docs/03-domain-model.md` become the join kind: LEFT JOIN when the row must survive and
the name may become null, INNER JOIN when the row is about the thing and must drop out.

**Children carry their owner.** `workout_days`, `workout_entries`, `workout_sets`,
`exercise_muscles` and `exercise_media` have an `owner_group_id`, bound to the parent's by a
composite foreign key `(parent_id, owner_group_id) → parent(id, owner_group_id)` with
`ON UPDATE CASCADE ON DELETE CASCADE`. A child's visibility is its own, so the "check the parent,
then trust the child" shape has nothing to trust, and every relation is a single-table filter —
the shape Postgres pulls up into the outer query, keeping its plans and indexes. A transfer is still
one UPDATE on the parent; Postgres carries the owner down.

**The holes are closed mechanically.**

- oxlint `no-restricted-imports` refuses importing the owned tables outside `db/`, the write files,
  each kind's `lifecycle.ts` (which hands its table to the shared ownable lifecycle for transfer and
  delete) and tests. Type imports are allowed.
- Writes cannot target a subquery, so each module keeps them in `write*.ts`, which may import the
  raw tables and gates every statement on them — write or guard read — with `editable()`.
- The Drizzle client is built without `{ schema }`, so the relational `db.query.*` API — which
  reaches every table with no import — does not exist.
- A source-scan test fails when an `sql` template outside those files names an owned table, the
  shape `dayBalance` leaked through.
- One suite removes a member through the real route and walks every GET route and MCP read tool. It
  fails when a read path has no case, so a new route cannot skip it.

`review/diagnostics.ts` is the one named exemption in module code: instance-wide counts for a
curator.

## Why

The predicate put the invariant in every author's head. The relation puts it in one module, where
lint can see whether it was used. A reviewer no longer asks "did they remember `visible()` on this
join?" — there is nothing else to join.

## Rejected

- **Postgres row-level security.** It would close every hole at once, writes included. It was
  rejected for what it costs in the finished shape rather than in the migration, because nobody yet
  deploys cedo. It needs a non-owner application role, since the bootstrap superuser bypasses
  policies. It needs every statement inside a request-scoped transaction, so that
  `SET LOCAL app.group_ids` reaches it: threaded through every module or carried in
  AsyncLocalStorage. Each request would hold one of ten pooled connections for its whole duration,
  on hardware the size of a NAS. It adds statements per request that the N+1 invariant
  (ADR-0018) must absorb. Instance diagnostics, which count every group's rows, would need a second
  role that bypasses the policies, and role switching inside the app. And it moves the rule into SQL
  policies, where the left-join-or-inner-join decision is implicit instead of visible at the call
  site.
- **Keeping the predicate and adding tests.** A test catches the read paths someone thought to
  test. The five misses were all in paths nobody had.
- **Every write through gated helpers in the ownable module.** About 35 write sites, including the
  plan diff in `writePlan`. The ownable module would have to learn how a plan is written. A
  per-module write file keeps that knowledge where it lives.
