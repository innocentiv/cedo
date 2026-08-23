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

| Mode                | Example                | Notes                                                                   |
| ------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `weight_reps`       | back squat             | the default                                                             |
| `bodyweight_reps`   | pull-up, push-up       | a logged `weight_g` means weight **added** to bodyweight                |
| `duration`          | plank, dead hang       | progresses via `linear_duration`                                        |
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

| Index                                                                           | Serves                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `sessions_token_hash_idx` (unique)                                              | auth — the hottest lookup in the system                          |
| `pats_token_hash_idx` (unique)                                                  | MCP auth                                                         |
| `group_members_user_idx`                                                        | building the caller's group list, on every request               |
| `users_username_idx` (unique)                                                   | sign-in                                                          |
| `exercises_owner_idx`, `workouts_owner_idx`                                     | the `visible()` predicate                                        |
| `exercises_name_trgm_idx` (GIN, `pg_trgm`)                                      | substring search over a five-figure library                      |
| `exercise_muscles_muscle_idx`                                                   | filtering the library by muscle                                  |
| `workout_days_workout_idx`, `workout_entries_day_idx`, `workout_sets_entry_idx` | loading a plan without N+1                                       |
| `set_logs_exercise_time_idx`                                                    | per-exercise history; the largest table by an order of magnitude |
| `workout_sessions_user_time_idx`                                                | the session list, newest first                                   |

Required extension: **`pg_trgm`**. Created by `migrate.ts`, since Drizzle Kit does not generate
extension statements. `pg_stat_statements` and `auto_explain` are enabled by the container.

## Adding an entity later

Recipes, ingredients, meal plans — all of it reuses this machinery. Spread `ownable()`, call
`favouriteTable()`, and sharing, favourites, duplication and ownership transfer work with **no new
access-control code**. The full recipe is in `docs/playbooks/add-entity.md`.
