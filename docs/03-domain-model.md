# Domain model

22 tables. Every shareable entity carries the same six `ownable()` columns, so access control is
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
users ──< progression_steps >── workout_entries       (a person's target on an entry;
                 └── workout_sessions?            the session a step judged, if any)
```

`exercises` and `workouts` hang off `groups` through `owner_group_id`. `workout_sessions` hangs off
`users` directly — logs are personal and are never shared, favourited or transferred.

`group_members.shares_training` is a member's own switch letting that group's editors **read** their
training — sessions, logs, notes, the review — and change none of it (#11). On the membership row, so
leaving or being removed withdraws it with the row; never set in a personal group or the library.
A read of training says whose sessions (`athleteId`) apart from who reads them (`reader`, whose
visible relations name what was logged): `Training` in `modules/coaching/training.ts`. See
`docs/adr/0021-coaching-through-groups.md`.

`users.weight_unit` (`kg` | `lb`) is how a person reads and types weights. It changes no stored
value — every weight is grams — only what is written for them: the app's screens and the AI's MCP
text alike, which is why it lives on the account and travels on the caller. It is theirs alone: `Me`
returns it (`Account`), and the `User` a fellow group member sees does not carry it.

`users.birth_year?` is the year a person was born (#42): from 1900 to ten years ago, null until they
say it, and set only by them — `PATCH /auth/me`, and `athlete_profile_set`, which takes that part of
its `MeUpdate` alone. `Me` returns it; a fellow member is never shown it, and whoever coaches them
reads only the age it makes this year, which the review carries (`TrainingReview.age`).

## The ownable trait

```ts
ownable() -> { id, owner_group_id, created_by, name, created_at, updated_at }
```

Spread into each entity table. Columns are physically repeated; **no supertable**. A create is one
INSERT, a read needs no join, and `visible()` / `editable()` are still written exactly once as
generics over the trait. So is the lifecycle every ownable shares — list with its scopes, search and
keyset, get, favourite, transfer, delete — in `modules/ownable/`, which each kind configures in its
own `lifecycle.ts`. See [adr/0003](adr/0003-ownable-columns.md).

### Children carry their owner

A **child** of an ownable — `workout_days`, `workout_entries`, `workout_sets`, `exercise_muscles`,
`exercise_media` — has its own `owner_group_id` (`childOwner()`), bound to its parent's by a composite
foreign key `(parent_id, owner_group_id) → parent(id, owner_group_id)` with `ON UPDATE CASCADE ON
DELETE CASCADE` (`ownerKey()`, against the parent's `ownerTarget()` unique). It is never written on its
own: a transfer is one UPDATE on the parent, and Postgres carries the owner down. A child row
claiming an owner its parent does not have is refused by the database.

So a child's visibility is its own. Nothing reads a day "because its workout was checked earlier".
See [adr/0019](adr/0019-visible-relations.md).

`created_by` is **provenance only** and is never consulted for permissions — the owning group
decides those.

### Everything belongs to a group

Every user gets a `kind: 'personal'` group at registration. There is no "owned by a user" case, so
there is exactly one ACL code path rather than two.

The seeded `cedo` group (`kind: 'shared'`) carries the starter library; every user joins it as a
`reader`, except a fresh instance's first account, which joins as its `editor`, the curator, and
closes sign-up behind it. A group member is an `editor` or a `reader`; only editors may write.

**Whether an instance takes new accounts** is `instance_settings`, one row and not owned by anyone:
`first` on a fresh instance, then `open` or `closed` at the curator's word. Registration locks it,
so a fresh instance has exactly one first account. See ADR-0029.

**Who can see a group's members:** an editor sees all of them; a reader sees the editors and
themselves. Because everyone reads the library, "any member sees every member" made `GET
/groups/:id/members` a list of every account on the instance. `memberCount` counts the same members
the caller can list.

**Who changes a group's members:** an editor adds and removes them; any member removes themselves —
leaving, on the same route — unless they are its last editor, since a group with no editor cannot
be administered again. A personal group is its owner's alone: nobody joins or leaves it. The
starter library keeps every account: the rule below lets a shared group's plans use its exercises
because every account reads it, so nobody leaves it, and no curator adds or removes anyone — its
members do not change through the API at all. `GroupMembership` carries `canManage` and
`canLeave`, so a client offers only what the server will accept.

### The ACL invariant

Reads go through **visible relations** (`db/visible.ts`): per owned table, the rows a caller may
read, as a subquery to select from or join. Writes live in a module's `write*.ts` and carry
`editable()` on every statement.

```ts
// read — the relation, never the raw table
const exercises = visibleExercises(caller)
db.select().from(exercises).where(eq(exercises.id, id))

// write — in modules/exercise/write.ts
db.update(exercisesTable)
  .set(patch)
  .where(and(editable(exercisesTable, caller), eq(exercisesTable.id, id)))
```

**A read of an owned table that does not go through its visible relation is a data leak.** It is
enforced, not remembered: lint refuses importing the raw tables outside `db/`, `write*.ts` and tests;
the Drizzle client has no `db.query`; and `raw-sql.test.ts` fails on an owned table named inside an
`sql` template. Not-found and not-permitted both return 404 — a 403 would confirm the resource
exists.

### It applies to JOINS, not just the row you asked for

This is the part that was missed five times, until the predicate became a relation. **Reading
your own row does not entitle you to a name joined onto it.**

Visibility is not permanent. Any editor may remove another member, so an exercise or workout that
was legitimately visible when a set was logged can be unreachable by the time anything reads that log
back. Personal data — sessions, set logs — is yours forever; **the names hanging off it are not.**

So a query that starts from something personal and joins to an owned table joins its **visible
relation**, and the join kind is the one decision left, depending on whether the row should survive:

| The joined name is | Do this | Because |
| --- | --- | --- |
| decoration on a row that must still appear | **LEFT JOIN** the relation | the row stays, the name becomes `null` |
| the subject of the row itself | **INNER JOIN** the relation, or select from it | the row drops out; there is nothing to say |

The first is `GET /sessions` (your session, someone else's workout name), `SetLog.exercise` (your
log, the name and tracking mode of an exercise you may have lost) and `WorkoutEntry.exercise`.
The second is `progression`, a person's target, `stalled` and `dayBalance` — advice about a movement you cannot read is
not advice.

The trap that used to sit beside this — a correlated subquery (`(select name from workouts where id =
…)`) is a join no predicate is watching, and `dayBalance` leaked exactly that way — has nothing raw
left to reach: `raw-sql.test.ts` fails on it.

`test/membership-lost.test.ts` proves the rule on every GET route and read-only MCP tool, and fails
when a new one has no case. Each case also states that it DID name the thing while the caller was a
member, so the rule cannot degenerate into "always return null".

## Entities

### Muscles — a hardcoded set

`MUSCLES` in `@cedo/contract` is the source of truth; the table is seeded from it so exercises get
foreign-key integrity and joinability. **Never insert into `muscles` directly.** 34 muscles.

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
extends that union with no change to `payload`'s column — but `kind` is the Postgres enum
`media_kind`, so a new kind is a migration adding its value (`ALTER TYPE … ADD VALUE`).

### Exercises — and how they are measured

`tracking` declares the tracking mode, which tells the UI which inputs to render and decides which
progression rules an entry of the exercise may have — one function in the contract, asked by the
plan save, the editor and MCP alike ([adr/0026](adr/0026-targets-and-steps.md)):

| Mode | Example | Rules | Notes |
| --- | --- | --- | --- |
| `weight_reps` | back squat | none, `linear`, `double` | the default |
| `bodyweight_reps` | pull-up, push-up | none, `linear`, `double` | a logged `weight_g` means weight **added** to bodyweight |
| `duration` | plank, dead hang | none, `linear_duration` | |
| `distance_duration` | rowing, farmer's carry | none, `linear_distance` | further at the prescribed pace; going faster is set deliberately — see [adr/0012](adr/0012-progression-rules.md) |

**The tracking mode is fixed when the exercise is created.** The update refuses it: plans and logs
measured one way would be left measured another, and refusing only while unused would need to see
plans in groups the caller cannot. To track a movement differently, duplicate it.

### Equipment — a hardcoded list of capabilities

`EQUIPMENT` in `@cedo/contract` is the source of truth, and the Postgres enum `equipment_item` is
generated from it — a new item is a migration adding its value. Each item is a capability, not a
product (*High pulley*, *Low pulley*, *Adjustable pulley*), grouped for the checklist, and
`weighted` when it holds the load. See [adr/0023](adr/0023-equipment-is-a-fixed-list.md).

`exercises.equipment` is what the exercise needs — all of it — as `equipment_item[]`. `NULL` is
**undescribed** and `{}` is **needs nothing**: an undescribed exercise is doable for everyone, and
the library audit lists it. The contract refuses an item twice, more than one weighted item, and a
weight belt, which no exercise needs. The seed describes a library entry still undescribed, so an
installation made before the list gets its library described at boot, and a curator's own
description stands.

A weight is logged as the equipment reads: a barbell's total, bar included; one dumbbell or
kettlebell; the number on a stack.

**Doable** (#35) is decided per athlete, on read — the reader, or the athlete a coach reads or
plans for (the `Training`'s athlete, resolved by `ownOrCoached`): `Exercise.doable` is `isDoable` in the
contract, against what they have (`heldBy`, one query per hydration, at any page size), and the
library's list carries the same rule as SQL (`doableFor`) unless asked to `showAll`.
`doable.test.ts` asks both on one set of exercises, so they cannot disagree. Undescribed on either
side is doable; a plan is never filtered, only marked.

### Workouts — three levels, supersets as a tag

```
workouts ──< workout_days ──< workout_entries ──< workout_sets
```

Entries in a day sharing a `superset_group` letter (`A`–`Z`) are performed alternating; null means
performed alone. A tag rather than a fourth nesting level, so reordering is one integer update.

`workout_sets.is_warmup` marks ramp-up sets. **An entry must prescribe at least one working set**,
enforced in the contract. Without the flag, a lifter who logs a warm-up ramp would have those sets
evaluated as their working sets and would never progress — see
[adr/0012](adr/0012-progression-rules.md). A warm-up is prescribed on its own line, reps and weight;
what it asks next session is its weight scaled by the working target, worked out on read and never
stored — or its own weight, when the working prescription has no positive weight to follow
([adr/0026](adr/0026-targets-and-steps.md)).

`workout_entries.progression` is JSONB validated by the `Progression` union. Its working sets carry
the entry's **prescription**, and the contract holds it to its rule
([adr/0026](adr/0026-targets-and-steps.md)):

- **Under a rule**, what the rule moves or judges (reps and weight under `linear` and `double`;
  seconds; distance and time) is the same on every working set, and only `target_rpe` — reps in
  reserve — may differ from set to set; each set is judged against its own. Under `double`, the reps
  lie inside `repRange`, and `from < to`.
- **Manual** (`kind: 'none'`) asks each working set for its own numbers.
- A rule that does not fit the exercise's tracking mode is refused.

### Targets and steps

```
progression_steps(id, user_id, entry_id, session_id?, taken_at, kind, from, target, held, streak,
                  against)
```

A person's **target** on an entry is their latest step, if that step was taken `against` the
prescription and rule as they stand; otherwise it is the prescription. Steps are per person, so two
people following one plan progress apart; a manual entry has none.

A **step** is written when a session is finished, or written finished by `session_log` — one for
each entry it trained under a rule: `from` and `target` (equal when it held), why it held, the
streak toward `afterSuccesses`, and `against`, the prescription's dimensions the rule moves or judges,
each working set's reserve, and the rule with its settings. `kind` is `session`, or `by_hand` when
the person set the target themselves (`PUT /workouts/:id/entries/:entryId/target`, MCP's
`target_set`), which obeys the same limit: a target differs from its prescription only in what the
rule moves. `taken_at` is the judged session's `started_at`, or the moment of a `by_hand` step, so
steps order as training did, not as rows were written.

Steps are personal, as sessions are — `user_id`, never an owning group — and a person reads only
their own. A target is advice about an entry, so it is read through the visible entries (INNER
JOIN): an entry out of reach has no target to show. `entry_id` and `session_id` are `ON DELETE
CASCADE`: an entry removed from a plan takes its steps with it (its logs stay, by exercise), and a
deleted session's steps go before the steps after it are taken again.

**Nothing resets a target by writing.** An edited prescription or rule leaves every step where it
is; a step whose `against` no longer matches stops counting, so followers start again from the new
prescription — and count again if it is put back, for each follower who has not trained since. The number of working sets,
the warm-ups, rest, cue, superset and order are not part of `against`.

**Corrections take steps again.** Correcting or removing a set of a finished session, or deleting a
finished session, takes every step of the affected entries from that session onward again, in the
transaction that made the change; finishing a session, or logging one whole, takes its own. Every
change to a session goes through one path that says so once, `changeSession`
(`modules/session/write-session.ts`): it reads what a finished session trained BEFORE the write,
so a removed set's entry, or a deleted session's, is still taken. A `by_hand` step
stays where it stands in time and the sessions after it are judged from it.

A step keeps the weight it advanced to — from the weight the person was shown, a loadable weight up
at least — and reading snaps it again to their equipment as it is now (see "Weights an athlete can
load").

An entry also tells the athlete two things beyond its numbers: `rest_seconds` (`rest.ts`) — two
minutes when not said, 0 or null for "straight on" — which the logger counts down from each
working set's `logged_at`, never longer than prescribed, as the server's clock and the device's
disagree; and `cue` (`cue.ts`), one line ("pause 1 s at the chest") of at most 200 characters,
every run of whitespace — a newline included — one space, blank stored as null (#51).

A superset rests after the round, never within it, whatever its earlier entries say
(`restingAfter`): the rest is that of the entry that ends the round — its last, or an earlier one
once the entries after it have no sets left. The plan says each rest where it sits (`restPlace`,
`restWords`) — `rest 1:30 after the round`, `rest 1:30 when it ends the round`, `straight on` —
alike in the MCP outline and the app (#48).

Ordering uses `(parent_id, index)` unique indexes. **API inputs carry no indices** — order is array
position and the server assigns them, which removes duplicate/gap indices and reorder endpoints
entirely. The same holds for a logged set's number — see Logs.

**Which exercises a plan may use** depends on where the plan lives, and is one rule whichever way
the plan got there — saved, duplicated or transferred (`assertPlanCanUse` in
`modules/workout/references.ts`):

1. Every exercise must be **visible** to whoever puts the plan there. A plan never starts out
   referencing what its owner cannot read.
2. In a **shared** group, every exercise must also be readable by every member **now and later**:
   owned by that group, or by the starter library, which every account joins at registration.
   Judged on the current members instead, a group holding only its creator would accept anything,
   and everyone added afterwards would get unreadable rows. A personal group, which nobody else
   ever joins, needs only (1).

Visibility can still change afterwards — a membership is removed, an exercise is transferred away —
so the read path is the second line of defence: an entry whose exercise the caller cannot see reads
as `exercise: null`, its prescription still legible and nothing about the exercise leaked. That is
the "Unavailable exercise" the UI shows, and three rules follow from it, the same in the app and over
MCP:

- **Its efforts read as measured.** Its tracking mode is withheld with its name, so
  `formatEffort(effort, null, unit)` says what was measured and guesses nothing: `6 × 20 kg`, never
  "bodyweight +20 kg".
- **Nothing more can be logged against it.** The server refuses the set; the session shows the
  entry's prescription and count, and no inputs.
- **A plan cannot be saved while it uses one** — rule (1) above. The plan's save line names the entry
  (`planIssues`, given what the editor can see), and nothing is sent until it is removed.

### An athlete's equipment

```
athlete_equipment(user_id, item, step_g?, min_g?, max_g?)    -- PK (user_id, item)
users.equipment_described_at?
```

What a person has to train with (#34), replaced whole. PERSONAL, as sessions are: a user's own,
never ownable, read by a coach only through `Training` (`ownOrCoached`). The weights are all three
or none — none being unknown — and only on an item that holds the load, which the contract checks
(`AthleteEquipmentInput`) and a CHECK backs. **Undescribed is not "nothing at all"**: until
`equipment_described_at` is set, nothing is filtered for them (#35); after, no rows means they
have nothing. A save locks the person's row first, so two at once take turns.

**Weights an athlete can load** (#36): an exercise's item that holds its load, and the athlete's
weights for it, make a `Load` (`loadOf`) — or none, when either is unknown, and nothing is snapped.
A plan keeps its weights. What a person is shown is the heaviest loadable weight not above their
target, capped at the heaviest and raised to the lightest (`loadable`), and progression judges a
session against what they were shown (`takeSteps`), never the plan's number — and moves it
up from there, a loadable weight at least, so an increase under one step still moves; the step keeps
the weight it advanced to, loadable the day it was taken. A warm-up's scaled weight is snapped down
the same way, and raised to the lightest. The grid is counted in the unit the athlete reads
(`Load.unit`): grams are not whole pounds. `EntryTarget.limit` says where it stops: at the heaviest
— asked it or more, or trained up to it (#66) — or under the lightest. See
[adr/0024](adr/0024-targets-follow-the-athletes-equipment.md), and
[adr/0026](adr/0026-targets-and-steps.md) for what a step keeps.

### Athlete records

Athlete notes and weigh-ins are both athlete records (GLOSSARY.md): PERSONAL, as sessions are,
read through `Training` (`ownOrCoached`, `coaching/training.ts`) by the person and by whoever
coaches them now, written by either — the one thing a coach writes of an athlete's — and removed by
whoever wrote it or by the person it is about. What they keep alike is
`athleteRecords(table, kind)` (`modules/athlete-record/records.ts`), bound to each kind's table:
the athlete's rows (`of`), the author projected and LEFT JOINed, who may remove one, and the 404.
Their tables are named only in their own modules (`note/`, `weigh-in/`, `athlete-record/`), `db/`
and tests: the lint refuses an import of them elsewhere, and `raw-sql.test.ts` a raw SQL mention.
Only these two are structured; anything else worth knowing is an athlete note (#40).

### Athlete notes

```
athlete_notes(id, athlete_id, author_id?, text, written_at, edited_at?)
```

What is known about a person, written down for planning their training (#41) — an injury, a
preference, what they said of a plan. An athlete record (above); only its author changes a note's
words. A coach's notes stay when they stop coaching; `author_id` goes
null only with the author's account. At most 100 a person (`NOTES_PER_ATHLETE`), so a list is
never paged; a note written locks the person's row first, so two at once cannot both pass the count.

### Weigh-ins

```
weigh_ins(id, athlete_id, author_id?, day, weight_g, taken_at)
```

A person's bodyweight on one day (#42, GLOSSARY.md "Weigh-in"): `day` on their own calendar, as
their device says it — never the server's; `weight_g` from 20 to 400 kg. One a day: the unique
`(athlete_id, day)` index makes another that day replace it (`ON CONFLICT DO UPDATE`), with whoever
took it as its author. An athlete record (above). Read over the review's weeks
(`Bodyweight`): the period's, newest first, and the latest before it, which the period's change is
measured from (`bodyweightTrend`) — at most a year's, so never paged, and the latest before the
period is listed with them, so a weigh-in the card names is always one it can remove. The review
carries that trend and their age.

### A rest

```
workout_sessions.rest_since?, rest_ends_at?
```

The rest after a set is kept by the server (#38): `rest_since` and `rest_ends_at` are worked out as
each set is logged by the contract's `restOf`, moved by +30 s and ended by skip (`POST
/sessions/:id/rest`, naming its rest by how many sets were logged), worked out again on Undo and on
a set corrected, and cleared by finishing. Every change to a session goes through `changeSession`
(`modules/session/write-session.ts`), which keeps it (`keepRest`, in `rest.ts`) in the change's own
transaction, under the session's lock — so changes at once keep theirs in the order they are made,
and a change refused keeps none.
Being told it is over with the app closed waits
for the native app (#39). See [adr/0025](adr/0025-rest-kept-by-the-server.md).

### Logs

```
workout_sessions(id, user_id, workout_id?, day_id?, started_at, ended_at?, notes?)
set_logs(id, session_id, entry_id?, exercise_id, set_index, is_warmup, weight_g, reps, rpe,
         duration_s, distance_mm, logged_at, idempotency_key?)
```

`idempotency_key` is the phone's key for one logged set, unique within its session. A set sent on
a weak signal may reach the server and lose its answer, so the app sends it again under the same
key, and the server answers a stored key with the stored set rather than logging a second (#9).
Null for a client that does not retry.

`rpe` — and a prescribed set's `target_rpe` — stores **reps in reserve** as `GLOSSARY.md` defines
it, written as ten minus it: 5 to 10, whole, or null when not said. The column is the only place
the RPE scale survives — the contract converts at the boundary (`rpe.ts`), and everything a person
or an AI reads or writes says reps in reserve ([adr/0027](adr/0027-reps-in-reserve-whole-everywhere.md)).
A rating, not a measurement, so it is `numeric(3,1)` rather than an integer in base units, with a
check holding whole steps for a write that bypasses the contract (`db/tables/rpe.ts`; ADR-0020,
as narrowed by ADR-0027). On the wire and in MCP the field is `reserve` — `targetReserve`
on a prescribed set — none to five; the contract converts to and from the column, and nothing past
it holds an RPE.

`workout_id`, `day_id` and `entry_id` are nullable so ad-hoc training uses the same tables and feeds
the same history. `exercise_id` is always set — that is what makes per-exercise history one indexed
read, and what a progress chart will consume later without a schema change.

They are `ON DELETE SET NULL`, which makes **day and entry identity load-bearing**: saving a plan
must keep the ids of what it keeps, or the logs are cut loose from the plan, its steps are deleted
with the entry, and progression starts over. A plan save diffs against what is stored — see "Nested resources" in `docs/06-api.md`. Only a
day or entry the plan no longer holds loses its link, and its logs stay in history by exercise.

**The server numbers every set** (`set_index`), within its **series** — the session's sets of one
plan entry, or of one exercise logged with no entry — one past the highest number in it, warm-ups
included: a number below the highest is never given again, and undoing the last set lets the next
take its number, as a correction would. The app and an AI send no number. A set whose entry is gone
counts as logged with none: removed from the plan (its `entry_id` is null) or out of the caller's
reach (a group plan they lost), so a session whose plan was lost goes on numbering its squats 2, 3
after the planned set 1. Reachability is read in ONE place — the session read and the numbering
both LEFT JOIN `planEntries`, so a log reads `entryId: null` exactly when it is numbered as one —
and the rule itself is the contract's `nextSetIndex`.

One number per set is kept by numbering under the session's row lock, not by a unique constraint —
deliberately. An entry can be removed from a plan underneath its logs, or its plan can go out of
reach; either way its logs join their exercise's entry-free series with the numbers they already
had, and a constraint over `(session, exercise, entry, set_index)` made the plan save a 500. A
number is never rewritten to make room, so either can leave two "set 1"s in that session's history
of the exercise, and nothing new is ever numbered into one.

**A session is in progress until it is finished, and finishing is final** — and it is finishing that
takes each trained entry's step, under the same lock. `ended_at` is set once,
on a session in progress, and never cleared; logging a set and finishing take the session's row
lock and refuse a finished session, so neither can interleave with a finish. **A past mistake can
be fixed** (#31): correcting a set (`PATCH …/logs/:logId`, its measures, reps in reserve and warm-up
— never its exercise or series) and removing one take the same lock but not the refusal, and `DELETE
/sessions/:id` deletes a session and its sets. Personal bests and the review are computed on read,
so they follow a fix with nothing to update. **Steps are the one thing derived from sets that is
stored** — a target depends on every session since its prescription, more than a read can afford —
so every write that changes a finished session takes the affected steps again, from that session
onward, in the transaction that changed it (see "Targets and steps"). Notes stay editable — a journal, not a change to what was logged. And **one session is in progress per
person**: `start` refuses a second, and a partial unique index on `user_id where ended_at is null`
holds it for starts that race, which a check alone does not. `session_log` writes a whole session
already finished, so it is never in progress at all. The session in progress is found by that index
(`GET /sessions?inProgress=true`), not by scanning a person's history for it.

## Index plan

Each of these exists because a specific query needs it. `bun run perf` proves each is actually used
against a realistic data volume — see [adr/0018](adr/0018-n1-detection.md).

| Index | Serves |
| --- | --- |
| `sessions_token_hash_idx` (unique) | auth — the hottest lookup in the system |
| `pats_token_hash_idx` (unique) | MCP auth |
| `group_members_user_idx` | building the caller's group list, on every request |
| `users_username_idx` (unique) | sign-in |
| `groups_slug_idx` (unique) | finding the seeded `cedo` library group by slug, and slug uniqueness |
| `users_external_idx` (unique, partial) | the IAM seam; only rows that have an `external_id` |
| **`exercises_owner_name_idx`** on `(owner_group_id, name, id)` | `scope=mine` and `scope=group`, where the owner is a single equality: the whole list query in one index walk |
| **`exercises_name_id_idx`** on `(name, id)` | `scope=all`, where the owner is an `IN` list and only the keyset columns can be walked in order |
| `exercises_name_trgm_idx` (GIN, `pg_trgm`, `fastupdate = off`) | substring search over a five-figure library, and the library audit's near-duplicate lookup — never behind a pending list |
| `exercise_muscles_muscle_idx` | filtering the library by muscle |
| **`workouts_owner_name_idx`** on `(owner_group_id, name, id)`, **`workouts_name_id_idx`** on `(name, id)` | the workout list, the same pair and the same reasons as the exercise ones |
| `muscles_region_idx` | rendering the muscle picker in display order |
| `media_created_by_idx` | a user's own uploads |
| `workout_days_order_idx`, `workout_entries_order_idx`, `workout_sets_order_idx` (unique, on `(parent_id, index)`) | ordering a plan, and — by their `parent_id` prefix — loading one without N+1 |
| `set_logs_exercise_time_idx` | the review's per-exercise aggregates, and the `exercise_id` foreign key on the largest table by an order of magnitude |
| `set_logs_session_idx`, `set_logs_entry_idx` | a session's own sets; a prescribed set's history |
| `set_logs_idempotency_idx` (unique, on `(session_id, idempotency_key)`) | one set per key in a session: the backstop to the check `logSet` makes under the session's lock |
| `workout_sessions_user_time_idx` on `(user_id, started_at desc nulls first, id desc nulls first)` | the session list, newest first — `id` included because the keyset cursor is a row comparison; `nulls first` because that is what `ORDER BY … DESC` means, and a mismatch turns the walk into a sort |
| `workout_sessions_workout_idx` | sessions belonging to a workout |
| `workout_sessions_in_progress_idx` (unique, partial: `ended_at is null`) on `user_id` | one session in progress per person, and finding it |
| `progression_steps_target_idx` on `(user_id, entry_id, taken_at desc)` | a person's target on an entry — their latest step — for a whole plan in one read; and the steps from a corrected session onward |
| `sessions_user_idx`, `pats_user_idx` | listing or revoking a user's credentials |
| `athlete_notes_athlete_idx` | a person's notes — at most 100, so sorted rather than walked in order, which the planner prefers |
| `weigh_ins_athlete_day_idx` (unique, on `(athlete_id, day)`) | one weigh-in a day, which a second replaces; and a period's, found among everyone's — at most a year's, sorted |

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
