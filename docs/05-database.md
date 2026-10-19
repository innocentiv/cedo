# Database

PostgreSQL 18, Drizzle ORM, `postgres.js` driver. Everything lives under `apps/api/src/db/`.

```
client.ts          the connection, plus per-call query recording
ownable.ts         the ownable() trait, ACL predicates, favouriteTable()
schema.ts          barrel — Drizzle Kit reads this
tables/            identity, reference, exercise, workout, log
migrate.ts         idempotent; runs at container start
seed.ts            idempotent; muscles, the cedo group, the starter library
seed-data/         the library as plain data, validated by a test
```

## Local development

```bash
bun run db:up                          # postgres on :55432
bun run apps/api/src/db/migrate.ts     # apply migrations
bun run apps/api/src/db/seed.ts        # muscles + cedo group + starter library

bun run db:reset                       # all of the above, from an empty volume
```

**Always start the database with `--wait`** (which `db:up` does). `docker compose up -d` returns as
soon as the container is _running_, which is well before Postgres accepts connections — the next
command then fails with `FATAL: the database system is starting up`. `--wait` blocks on the
healthcheck instead. The same applies in CI and in any script that seeds or tests.

Both scripts are safe to re-run. That is a requirement, not a nicety: a self-hosted instance
restarts for reasons nobody planned, and an upgrade must be able to add library entries without
duplicating what is already there.

## Defining a table

```ts
export const exercises = pgTable(
  'exercises',
  {
    ...ownable(), // id, owner_group_id, created_by, name, timestamps
    tracking: trackingMode('tracking').notNull().default('weight_reps'),
    description: text('description').notNull().default(''),
  },
  (t) => [
    // owner_group_id needs no index of its own: it is the left prefix of this one.
    index('exercises_owner_name_idx').on(t.ownerGroupId, t.name, t.id),
    index('exercises_name_id_idx').on(t.name, t.id),
    index('exercises_name_trgm_idx')
      .using('gin', sql`${t.name} gin_trgm_ops`)
      .with({ fastupdate: false }),
  ],
)
```

A GIN index is `fastupdate = off` here. Its default parks new entries in a pending list that every
lookup scans linearly until a vacuum flushes it — below the 4 MB that forces a flush, indefinitely —
and a bulk import of exercises left name search at 5s instead of 0.3s. These tables are written
rarely and searched constantly, so an index pays at write time instead. `db/trigram.test.ts`
asserts it.

Each index here exists for a query the perf suite measured — see `docs/03-domain-model.md` for why
there is deliberately no bare `owner_group_id` index. A `.desc()` column that a query ORDERS BY must
be `.desc().nullsFirst()`, because Drizzle's `.desc()` builds `DESC NULLS LAST` while `ORDER BY …
DESC` means `NULLS FIRST`, and the planner then sorts instead of walking the index. Do not rebuild one
nothing orders by: on a large table the rebuild blocks writes during the upgrade, for no gain.

Rules:

- **Enums come from the contract.** `pgEnum('tracking_mode', TRACKING_MODES)` — never retype the
  values, or the database and the API will drift.
- **Every foreign key declares `onDelete`.** `cascade` for children, `restrict` for references that
  must block deletion, `set null` for optional links.
- **Add the index in the same commit as the query that needs it**, and a guard in
  `bun run perf`. See [adr/0018](adr/0018-n1-detection.md).
- **JSONB columns are typed with `$type<T>()`** and validated by the matching Zod union on read and
  write. Used for `progression` and `media.payload`, so adding a variant needs no migration.

## Querying

```ts
// READ — always through the visible relation (db/visible.ts)
const exercises = visibleExercises(caller)
db.select().from(exercises).where(eq(exercises.id, id))

// WRITE — in the module's write*.ts, always editable() on the statement
db.update(exercisesTable)
  .set(patch)
  .where(and(editable(exercisesTable, caller), eq(exercisesTable.id, id)))
```

A read around the relation is a data leak, not a style issue. See `docs/02-conventions.md` and
[adr/0019](adr/0019-visible-relations.md).

**The client is built without `{ schema }`.** That disables Drizzle's relational `db.query.*` API on
purpose: it reaches any table by name, with no import for lint to see. Use the query builder.

**A relation must stay flattenable.** Postgres pulls `(select * from t where owner_group_id in (…))`
up into the outer query, which is what keeps every index usable through it. A LIMIT, OFFSET,
DISTINCT or ORDER BY inside a relation is an optimisation fence, and `bun run perf` reports the
resulting `Seq Scan`. (Drizzle silently drops `.offset(0)`, so it is not even a usable fence to test
with.)

**A child table carries its owner.** Spread `childOwner()` into it and bind it with `ownerKey()` to
the parent's `ownerTarget()` — the composite key replaces the plain `parent_id` reference. See
`docs/03-domain-model.md`.

## Migrations

```bash
cd apps/api && bunx drizzle-kit generate --name=what_changed
bun run apps/api/src/db/migrate.ts
```

Generated SQL is **committed**. Never edit an applied migration — add a new one.

`migrate.ts` creates `pg_trgm` before applying migrations, because Drizzle Kit does not generate
extension statements and the trigram index depends on one.

Postgres NOTICEs ("extension already exists, skipping") are routed to debug output by the `onnotice`
handler in `client.ts`. Left alone, `postgres.js` prints them as raw objects that read exactly like
crashes — which matters when the person reading the logs is a stranger self-hosting this.

## Seeding

`seed.ts` is idempotent by construction:

- **muscles** — upserted from the `MUSCLES` constant, which is the source of truth.
- **the `cedo` group** and a **system user** — created once. The system account exists because
  `created_by` is NOT NULL and the library needs an owner; its password hash is a discarded random
  value, so nobody can sign in as it.
- **exercises** — matched by name, so re-running adds only what is new. That is the upgrade path: a
  release that extends the library reaches existing installations without duplicating anything.

Every library entry is validated against `ExerciseCreate` before it is written, so a typo fails the
seed rather than producing a silently wrong library. `seed-data/exercises.test.ts` runs the same
checks with no database, plus coverage assertions: names unique, every tracking mode used, every
muscle trained by at least one exercise.

Seeded media are YouTube **search** URLs, not specific video ids. Inventing ids would give every
user dead links and broken thumbnails; a search always resolves. Users and the AI replace them with
real videos through the media endpoints.

### The performance seed

`seed-perf/` builds a **separate** database (`cedo_test_perf`, selected by `CEDO_PERF=1`) at
production volume: 250,000 set logs, 10,000 shared exercises, 1,000 plans, 5,000 sessions, plus
media, favourites and browser sessions. It shares nothing with `seed.ts` beyond `seedMuscles`,
because it is answering a different question.

Three rules govern it:

- **Every value is derived arithmetically from a row number** — not even a seeded PRNG. Two runs
  produce byte-identical data, so a query plan that changed did so because the code changed.
- **It is written as bulk `insert … select … from generate_series`.** A quarter of a million rows
  through ORM value lists takes minutes; this takes about thirty seconds, and it is then reused
  across runs.
- **It ends settled — `VACUUM ANALYZE`, not just `ANALYZE`.** A bulk load leaves a GIN index's new
  entries in a pending list that every lookup scans linearly until a vacuum flushes it; the trigram
  search ran at 5s instead of 0.3s for the first runs after each seed. The suite counts what is
  still pending, read-only (`pgstattuple`, in the perf database only), and fails on any.

It is also, with the perf suite's own probes beside it, the one place raw SQL is correct. Everything
the application runs goes through Drizzle.

## Query counting

`client.ts` records every statement issued inside `withQueryCount()`, via Drizzle's `logger` hook
and an `AsyncLocalStorage`. This is what makes N+1 detectable as an invariant rather than a guessed
threshold — see [adr/0018](adr/0018-n1-detection.md).

```ts
const { result, count, statements } = await withQueryCount(() => ExerciseService.list(ctx, query))
```

## Planner settings

The `db` service overrides one Postgres default that matters a great deal here:

```
-c random_page_cost=1.1
```

The default of `4.0` models a spinning disk. Every machine cedo realistically runs on — a NAS, a
mini PC, a VPS — has SSD or NVMe, and at the default the planner systematically overvalues
sequential scans.

The concrete case that exposed it: `GET /exercises?q=…` uses `ILIKE '%…%'`, which the
`exercises_name_trgm_idx` GIN index serves. At 20,000 rows the planner ignored that index and
sequentially scanned, discarding 20,044 rows by filter.

|  | Buffers | Time |
| --- | --- | --- |
| `random_page_cost=4` (default) | 354 | 5.96 ms |
| `random_page_cost=1.1` | 17 | 0.077 ms |

The index was never the problem — forcing `enable_seqscan=off` produced the fast plan all along.
**An index existing is not the same as an index being used**, which is exactly why `bun run perf`
asserts plans rather than just timings. See [adr/0018](adr/0018-n1-detection.md).

`docker-compose.test.yml` sets the same value, so the performance suite measures the plans
production will actually get.
