# Domain model

18 tables. Every shareable entity carries the same six `ownable()` columns, so access control is
written once and inherited by anything added later.

## Shape

```
groups ──< group_members >── users
  │                            │
  │                            ├──< sessions                 (bearer tokens, sha256 only)
  │                            └──< personal_access_tokens   (MCP credentials)
  │
  ├──< exercises ──< exercise_muscles >── muscles     (hardcoded set, seeded from the contract)
  │        │      └─< exercise_media   >── media      (kind + JSONB payload)
  │        └──< exercise_favourites >── users
  │
  └──< workouts ──< workout_days ──< workout_entries ──< workout_sets
           └──< workout_favourites >── users

users ──< workout_sessions ──< set_logs >── exercises
```

`exercises` and `workouts` hang off `groups` through `owner_group_id`. `workout_sessions` hangs off
`users` directly — logs are personal and are never shared, favourited or transferred.

## The ownable trait

```ts
ownable() -> { id, owner_group_id, created_by, name, created_at, updated_at }
```

Spread into each entity table. Columns are physically repeated; **no supertable**. A create is one
INSERT, a read needs no join, and `visible()` / `editable()` / transfer / duplicate are still
written exactly once as generics over the trait. See [adr/0003](adr/0003-ownable-columns.md).

`created_by` is **provenance only** and is never consulted for permissions — the owning group
decides those.

### Everything belongs to a group

Every user gets a `kind: 'personal'` group at registration. There is no "owned by a user" case, so
there is exactly one ACL code path rather than two.

The seeded `cedo` group (`kind: 'shared'`) carries the starter library; every user joins it as a
`reader`. A group member is an `editor` or a `reader`; only editors may write.

### The ACL invariant

```ts
db.select()
  .from(exercises)
  .where(and(visible(exercises, ctx), eq(exercises.id, id)))
db.update(exercises)
  .set(patch)
  .where(and(editable(exercises, ctx), eq(exercises.id, id)))
```

**A query on an ownable table that omits `visible()` or `editable()` is a data leak.** Every module's
test file must prove cross-user isolation. Not-found and not-permitted both return 404 — a 403 would
confirm the resource exists.

### It applies to JOINS, not just the row you asked for

This is the part that keeps being missed, and it has now had to be fixed in five places. **Reading
your own row does not entitle you to a name joined onto it.**

Visibility is not permanent. Any editor may remove another member, so an exercise or workout that
was legitimately visible when a set was logged can be unreachable by the time anything reads that log
back. Personal data — sessions, set logs — is yours forever; **the names hanging off it are not.**

So a query that starts from something personal and joins to an ownable table still needs the
predicate, and there are two shapes depending on whether the row should survive:

| The joined name is | Do this | Because |
| --- | --- | --- |
| decoration on a row that must still appear | `visible()` in the **JOIN condition**, left join | the row stays, the name becomes `null` |
| the subject of the row itself | `visible()` in the **WHERE** | the row drops out; there is nothing to say |

The first is `GET /sessions` (your session, someone else's workout name) and `WorkoutEntry.exercise`.
The second is `progression`, `stalled` and `dayBalance` — advice about a movement you cannot read is
not advice.

Two traps worth naming. A child inherits its parent's visibility rather than having its own, so a
`workout_days` name is gated by joining through its workout. And a correlated subquery
(`(select name from workouts where id = …)`) is a join that no predicate is watching — `dayBalance`
leaked exactly that way. Prefer a real join, where `visible()` has somewhere to go.

`review/visibility.test.ts` holds the reproduction, and the counterpart test that fails if the fix
degenerates into "always return null".

## Entities

### Muscles — a hardcoded set

`MUSCLES` in `@cedo/contract` is the source of truth; the table is seeded from it so exercises get
foreign-key integrity and joinability. **Never insert into `muscles` directly.** 32 muscles.

`exercise_muscles.load_pct` is a percentage of total load. The sum-to-100 and uniqueness invariants
are enforced in the contract, because a cross-row constraint would need a trigger and the contract's
error is the one a caller can act on. The per-row `between 1 and 100` bound is a database CHECK, so
a bad direct insert still fails.

The library covers every muscle at least once, asserted by a test.

### Media — kind plus payload

```
media(id, kind, title, payload JSONB, thumbnail_key, created_by, created_at)
```

`payload` is validated by a Zod discriminated union: `image` (blob key, mime, dimensions, sha256) or
`video_link` (provider, source URL, external id). Adding `video_upload`, `gif` or `model_3d` later
is a union extension with **no migration** — the same pattern as `progression`.

### Exercises — and how they are measured

`tracking` declares the measurement mode, which tells the UI which inputs to render and tells a
progression rule which dimension to advance:

| Mode | Example | Notes |
| --- | --- | --- |
| `weight_reps` | back squat | the default |
| `bodyweight_reps` | pull-up, push-up | a logged `weight_g` means weight **added** to bodyweight |
| `duration` | plank, dead hang | progresses via `linear_duration` |
| `distance_duration` | rowing, farmer's carry | no automatic progression; see [adr/0012](adr/0012-progression-rules.md) |

### Workouts — three levels, supersets as a tag

```
workouts ──< workout_days ──< workout_entries ──< workout_sets
```

Entries in a day sharing a `superset_group` letter (`A`–`Z`) are performed alternating; null means
performed alone. A tag rather than a fourth nesting level, so reordering is one integer update.

`workout_sets.is_warmup` marks ramp-up sets. **An entry must prescribe at least one working set**,
enforced in the contract. Without the flag, a lifter who logs a warm-up ramp would have those sets
evaluated as their working sets and would never progress — see
[adr/0012](adr/0012-progression-rules.md).

`workout_entries.progression` is JSONB validated by the `Progression` union.

Ordering uses `(parent_id, index)` unique indexes. **API inputs carry no indices** — order is array
position and the server assigns them, which removes duplicate/gap indices and reorder endpoints
entirely.

### Logs

```
workout_sessions(id, user_id, workout_id?, day_id?, started_at, ended_at?, notes?)
set_logs(id, session_id, entry_id?, exercise_id, set_index, is_warmup, weight_g, reps, rpe,
         duration_s, distance_mm, logged_at)
```

`workout_id`, `day_id` and `entry_id` are nullable so ad-hoc training uses the same tables and feeds
the same history. `exercise_id` is always set — that is what makes per-exercise history one indexed
read, and what a progress chart will consume later without a schema change.

## Index plan

Each of these exists because a specific query needs it. `bun run perf` proves each is actually used
against a realistic data volume — see [adr/0018](adr/0018-n1-detection.md).

| Index | Serves |
| --- | --- |
| `sessions_token_hash_idx` (unique) | auth — the hottest lookup in the system |
| `pats_token_hash_idx` (unique) | MCP auth |
| `group_members_user_idx` | building the caller's group list, on every request |
| `users_username_idx` (unique) | sign-in |
| `users_external_idx` (unique, partial) | the IAM seam; only rows that have an `external_id` |
| **`exercises_owner_name_idx`** on `(owner_group_id, name, id)` | `scope=mine` and `scope=group`, where the owner is a single equality: the whole list query in one index walk |
| **`exercises_name_id_idx`** on `(name, id)` | `scope=all`, where the owner is an `IN` list and only the keyset columns can be walked in order |
| `exercises_name_trgm_idx` (GIN, `pg_trgm`) | substring search over a five-figure library |
| `exercise_muscles_muscle_idx` | filtering the library by muscle |
| **`workouts_owner_name_idx`** on `(owner_group_id, name, id)`, **`workouts_name_id_idx`** on `(name, id)` | the workout list, the same pair and the same reasons as the exercise ones |
| `muscles_region_idx` | rendering the muscle picker in display order |
| `media_created_by_idx` | a user's own uploads |
| `workout_days_workout_idx`, `workout_entries_day_idx`, `workout_sets_entry_idx` | loading a plan without N+1 |
| `set_logs_exercise_time_idx` | the review's per-exercise aggregates, and the `exercise_id` foreign key on the largest table by an order of magnitude |
| `set_logs_session_idx`, `set_logs_entry_idx` | a session's own sets; a prescribed set's history |
| `workout_sessions_user_time_idx` on `(user_id, started_at desc, id desc)` | the session list, newest first — `id` included because the keyset cursor is a row comparison |
| `workout_sessions_workout_idx` | sessions belonging to a workout |
| `sessions_user_idx`, `pats_user_idx` | listing or revoking a user's credentials |

### Why the list needs two index shapes

There is deliberately **no** standalone `exercises_owner_idx` — it is the left prefix of
`exercises_owner_name_idx`, which Postgres can use for both.

Keyset pagination orders and ranges on `(name, id)`. A GIN trigram index serves **neither** an
`ORDER BY name` nor a `name > $1` range; it answers substring matches and nothing else. With only
the owner index and the trigram index, Postgres sequentially scanned every visible exercise and
sorted it on every page, so page 200 cost the same as page 1.

The composite fixes that only when `owner_group_id` is a single equality — `scope=mine`,
`scope=group`. The **default** scope is `all`, where the filter is `owner_group_id in (…every group
the caller belongs to…)`, and there Postgres has no plan that walks many index ranges in merged name
order: measured at production volume it read all 11,000 visible rows and top-N sorted them on every
page.

`exercises_name_id_idx` on `(name, id)` alone is what serves that scope. The keyset walks in order
and stops at the page size — 0.15 ms and 48 buffers instead of 2.4 ms and 332, and constant as the
library grows. It works because every user is a reader of the shared `cedo` group, so a caller can
see most of the table and a full page is found immediately.

Two lessons this encodes, both learned the hard way:

- **An index existing is not an index being used.** Assert the *plan*, never just the timing.
- The planner will not prefer these at all without `random_page_cost=1.1` — see
  [05-database.md](05-database.md).

Required extension: **`pg_trgm`**. Created by `migrate.ts`, since Drizzle Kit does not generate
extension statements. `pg_stat_statements` and `auto_explain` are enabled by the container.

## Adding an entity later

Recipes, ingredients, meal plans — all of it reuses this machinery. Spread `ownable()`, call
`favouriteTable()`, and sharing, favourites, duplication and ownership transfer work with **no new
access-control code**. The full recipe is in `docs/playbooks/add-entity.md`.
