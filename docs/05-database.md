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
    index('exercises_owner_idx').on(t.ownerGroupId),
    index('exercises_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)
```

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
// READ — always visible()
db.select()
  .from(exercises)
  .where(and(visible(exercises, ctx), eq(exercises.id, id)))

// WRITE — always editable()
db.update(exercises)
  .set(patch)
  .where(and(editable(exercises, ctx), eq(exercises.id, id)))
```

Omitting the predicate is a data leak, not a style issue. See `docs/02-conventions.md`.

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

## Query counting

`client.ts` records every statement issued inside `withQueryCount()`, via Drizzle's `logger` hook
and an `AsyncLocalStorage`. This is what makes N+1 detectable as an invariant rather than a guessed
threshold — see [adr/0018](adr/0018-n1-detection.md).

```ts
const { result, count, statements } = await withQueryCount(() => ExerciseService.list(ctx, query))
```
