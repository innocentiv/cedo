# The MCP server

An AI is a first-class operator of this application, not a bolt-on. The MCP server runs **inside**
the API — same process, same services, same access control — so it is impossible for the app and the
AI to disagree about a rule.

```
claude ──JSON-RPC over HTTP──> POST /api/mcp
                                   │  Elysia resolves a personal access token to a Caller
                                   v
                               mcpHandler.fetch(request, { authInfo: { extra: { caller } } })
                                   │
                                   v
                               a fresh McpServer per request
                                   │  tools close over that caller
                                   v
                               the SAME service functions the HTTP routes call
```

## Connecting

Bring your own AI: the instance holds no model and no provider key, and sends nothing to one. MCP is
the single AI surface, so connecting is an address and a token. **Settings → Connect your AI** says
this instance's address (the page's own origin + `/api/mcp`), creates a token, and shows both
configurations below with the two filled in, ready to paste. They are built by the contract's
`connect.ts`, and the API mounts its server at the same `MCP_PATH`, so the address cannot drift
from the route.

**Claude Code** — for the user, so every project sees it (`local`, the default, is one folder only):

```bash
claude mcp add --transport http --scope user cedo https://<host>/api/mcp --header "Authorization: Bearer <token>"
```

**Clients that read an `mcpServers` file** — Claude Code's `.mcp.json`, Cursor's `mcp.json`:

```json
{
  "mcpServers": {
    "cedo": {
      "type": "http",
      "url": "https://<host>/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**VS Code** — the same server under a top-level `servers` key, in `.vscode/mcp.json`:

```json
{
  "servers": {
    "cedo": {
      "type": "http",
      "url": "https://<host>/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

The token travels only in the `Authorization` header, so a client must be able to send one. A client
that connects a remote server by URL and OAuth alone — Claude Desktop's and claude.ai's custom
connectors — cannot connect yet: this server issues no OAuth tokens.

A **personal access token**, not a session token. The two are deliberately not interchangeable: a
PAT is long-lived and pasted into a client's config, a session belongs to a browser. Passing a
session token to `/mcp` is a 401, and a test asserts it.

## What it is for

Three objectives today, and a fourth planned; every tool exists to serve one of them.

### 1. Curating the exercise library

Reviewing and creating exercises from reliable sources, with correct muscle attribution.

`library_audit` · `exercise_search` · `exercise_get` · `exercise_create` · `exercise_update` ·
`exercise_duplicate` · `media_add_link` · `muscle_list` · `group_list`

**The guardrail matters more than the capability.** The expensive failure is not a missing tool, it
is creating "Barbell Bench Press" beside an existing "Bench Press", or attributing muscles
inconsistently across similar movements. So `library_audit` reports near-duplicates (by the same
`pg_trgm` similarity that backs search), muscles with thin or no coverage, and entries missing
instructions, media or the equipment they need. The tool descriptions tell the model to read before
it writes.

An exercise's equipment is read and written as slugs from the fixed list (`EquipmentSlug`, whose
JSON schema enumerates them), and printed as `barbell + rack`, `no equipment`, or `equipment not
described` — the last two kept apart, since an undescribed exercise is offered to everyone (#33).

`equipment_get` and `equipment_set` (`mcp/tools/equipment.ts`) are what someone has to train with
(#34): read before planning — an exercise needs every item `exercise_get` lists — and said whole,
weights in grams. `equipment_get` takes the coaching tools' `athlete`, so a coach plans for an
athlete's gym; `equipment_set` is only ever your own.

`exercise_search` offers only what the caller's equipment lets them do unless `showAll` (#35), and
an exercise they cannot do is marked "Missing equipment" there, in `exercise_get` and in
`workout_get`'s outline — never left out of a plan. `exercise_search` and `workout_get` take
`athlete` too: a coach's AI planning for someone searches, and reads the plan, by what THEY have.

Every exercise and workout line names its owning group: `mine`, `library`, or the group's name
(#47). `group_list` (`mcp/tools/groups.ts`) lists the caller's groups that way, with their role and
the id the tools that take one want: `exercise_search` and `workout_list` with `scope: 'group'`,
`exercise_duplicate`'s `toGroupId`, `library_audit`'s `groupId` (#52).

An exercise's tracking mode is fixed when it is created (ADR-0026): `exercise_update` refuses a
new one, saying to duplicate the exercise to track the movement differently — plans and logs that
use it, some in groups the caller cannot see, were made in its mode.

Writing to the shared library requires **curator** rights (below). Anything else lands in the
caller's own group — and `exercise_duplicate` is how an AI adapts a library exercise for someone
without them: a copy in a group they edit, as `workout_duplicate` is for a shared workout.

### 2. Reviewing someone's training

`training_review` · `workout_list` · `workout_get` · `workout_get_editable` · `workout_create` ·
`workout_update` · `workout_save_plan` · `workout_duplicate` · `workout_progression` · `target_set` ·
`exercise_history` · `session_log` · `session_fix_set` · `note_list` · `note_create` · `note_update` · `weigh_in_list` ·
`weigh_in_create` · `athlete_profile_set`

`note_list`, `note_create` and `note_update` (`mcp/tools/athlete-file.ts`) are **athlete notes** (#41,
`GLOSSARY.md`): what is known about someone, kept for planning their training — an injury, a
preference, what they said of a plan. Each takes the coaching tools' `athlete`: a coach writes them
too (ADR-0021, amended). `training_review` and the plan-writing tools say to read them first; the
review does not carry them, so a plan made without asking is the model's omission, not a stale
payload. Only the author rewords one, and none is removed here — the app does that, behind a tap.

`workout_update` changes a workout's name and notes (#44) — `PATCH /workouts/:id`, through the
same `WorkoutService.update`: an omitted field is left alone, `notes: null` clears them. The notes
are the **workout's**, not its plan's (`GLOSSARY.md`): how it is run — effort, block structure,
deload, the bad-day rule — so they change when the plan does. They are not versioned with the
plan: an edit neither checks nor raises its version (ADR-0022 guards the plan), so a save from
an earlier `workout_get_editable` still lands, and the last edit to the notes wins. It replaces
the whole text, so it is announced destructive and idempotent, as `note_update` is, and says to
read `workout_get` first. It takes no `athlete`: who may change it is whoever edits its group,
and what is true of the person following it — their equipment, an injury — goes to
`equipment_set` or an athlete note instead.

`weigh_in_list` and `weigh_in_create` (the same file) are **weigh-ins** (#42): a bodyweight a day,
in grams, read over the review's weeks with the latest before them — yours, or an athlete's with
`athlete`. Another that day replaces the first, so `weigh_in_create` is announced destructive and
idempotent. `training_review` carries the latest and its change over its weeks, and the age the
year of birth makes: `Bodyweight 82.4 kg on Fri 30 Oct, −1.6 kg since Tue 1 Sep. Age 36 this
year.` — the age, never the year of birth. `athlete_profile_set` sets the year you were born, by
`PATCH /auth/me`'s own schema narrowed to it (`MeUpdate.pick`), and is only ever yours: how you read
weights stays yours to choose in the app.

`session_log` and `session_fix_set` record training as it was done (`mcp/tools/session.ts`): a
whole session the AI is told about, and a set already logged corrected (#31) — "80, not 100, on
Monday" — named by the `[id]` `session_get` prints beside each of your own sets. Removing a set
or a session is not among them: see "Nothing can be deleted". Each changes what progression has
judged: a session logged takes a **step** (`GLOSSARY.md`) for each entry it trained under a rule, as finishing
one does — dated now, it is the latest — and a set corrected takes every step of those entries again
from its session onward (ADR-0026).
Reps in reserve are sent whole, none to five; a half is refused.

`training_review` is the entry point, and it is a **read model, not new domain rules** — pure
aggregation over data the API already exposes. It exists because the alternative is the model paging
through every session and doing date arithmetic itself, which is slow, expensive in context, and a
reliable source of quiet errors. One call returns adherence (sessions per week, streak, longest
gap), which planned days are being skipped, working sets per muscle against the preceding period,
and which exercises have stalled. "Stalled" is the one judgement it makes rather than aggregates —
the same top set, three or more sessions running (`GLOSSARY.md`) — judged by the contract's
`stallOf` on what was logged, ranked by its `topSet`, over the latest ten sessions — the rule the
exercise screen's badge reads too, through `exercise_history`. A weight lift's stall says its **estimated max**
(`GLOSSARY.md`, the contract's `estimate.ts`), and `exercise_history` gives each session's best,
so the AI reads progress across rep counts without doing the arithmetic.

Beside the stall it says the two **deload** triggers (`GLOSSARY.md`), judged over the same latest
sessions (`review/deload.ts`): a weight lift **falling** — its best estimated max down in each of its
latest two sessions or more — and **effort drift** — the latest top set leaving at least one rep
fewer in reserve in each of the latest two sessions than on average before them. Each session must
cross the line on its own, so one hard set or one bad day says nothing: a reserve a person rates is
off by about one.

The two read different things, so one cause is never said twice. Falling is estimated from what was
**lifted**, the reserve left out: counted, the same set rated a rep fewer in reserve each time would
read as a fall made of rating noise. That is drift's to say, and drift needs the reserve said both
before and since. A heavier set is harder by its load and is not compared, so drift goes quiet the session the
load goes up. A bodyweight lift has no estimated max, so it can drift but cannot fall. Each section
appears only when it has something to say:

```
Falling (estimated max from what was lifted, down 2+ sessions running):
  Bench Press: down in each of the latest 3 sessions, 77 kg → 66.5 kg

Effort drift (1+ rep fewer in reserve at the same set, in each of the latest 2 sessions):
  Row at 8 × 50 kg: average 3 → 1.5 in reserve
```

A reserve is rated whole, but an average of them need not be: `1.5` is an average, not a rating
(ADR-0027).

The review only says them. Deloading is the AI's to do, by saving a lighter plan — the progression
rule never lowers a weight by itself (ADR-0012).

The work per muscle is what the load percentages are **for**: each working set counts toward a
muscle by `load_pct / 100` — a set of a 70/30 exercise is 0.7 of a set for one muscle and 0.3 for the
other — warm-ups excluded. Sets, because they count every tracking mode alike: weight × reps, which
it used to be, read a plank, a run or an unweighted pull-up as "0 kg". Weight × reps stays beside the
sets as what was lifted, for loaded work only.

The review, not the formatter, chooses which muscles are worth saying — the twelve worked most,
every declined muscle (`GLOSSARY.md`), and a count of the rest — because only the review knows what
the comparison is for (`review/muscle-work.ts`).

**Progression is read, not proposed.** A plan's entry says where each follower starts — its
**prescription** — and each follower has their own **target**: their latest **step** on that entry, if
it was taken against the prescription and rule as they stand, and the prescription otherwise
(`GLOSSARY.md`, ADR-0026). A step is written when a session is finished, once per entry it trained
under a rule. `workout_progression` reads the caller's targets and their latest steps; the app's
logger reads the same target (`GET /sessions/:id/targets`), so the AI and the logger cannot ask for
different numbers. A session in progress moves nothing until it is finished. Both answer in weights
the athlete can load (#36, ADR-0024): a step keeps the weight it advanced to, loadable the day it
was taken (ADR-0026), and reading it snaps it to the caller's equipment as it is now. `workout_get` keeps the plan's weights as
written, a set the athlete cannot load as written followed by `(loads 22 kg)` — or
`(loads 30 kg, your heaviest)` — for them, or for `athlete`.

Each `workout_progression` line ends with what stands behind the target (#66): `from 3 sessions` —
those since it last started, from the prescription — `set by hand`, `set by hand, then 1 session`,
or `no session yet`, which is also what a plan edit leaves. A target at the heaviest weight the
athlete can load says `(your heaviest)`: there is nothing heavier for it to move to, so it is not
read as a stall. The target is the contract's one shape, `EntryTarget`, which the app's plan editor
and logger read too.

Each step is said with why: advanced, from what to what, or held — `held: set 3 did 7 of 10`, short
of the target, or `held for effort: set 3 left 0 in reserve, asked 2`, a set ground out past its own
reserve. Each working set is judged against the reserve it asks, so a plan whose last set may go to
failure asks 0 of that set and holds nothing for it. A hold for effort is not a stall, and no reason
to deload: the reps were there, done harder than asked. The rules' maths is `step`'s, which the
contract reaches only through `takeSteps`; see
[adr/0012](adr/0012-progression-rules.md) for the truth tables — its effort table as amended, each
set against its own reserve ([adr/0026](adr/0026-targets-and-steps.md)) and whole
([adr/0027](adr/0027-reps-in-reserve-whole-everywhere.md)) — and 0026 for what they are applied to.

**A plan edit restarts its followers' targets — reversibly.** Editing what an entry's prescription
asks, or its rule, writes nothing to anyone's steps: a step taken against something else simply
stops counting, so every follower's target is the new prescription — until it is put back, which
restores the target of each follower who has not trained since. The number of working sets, warm-ups, rest, cue,
superset and order are not part of what a step is compared against. Re-aligning a plan with where
its follower got to — when a new phase of training starts, after a deload, say — is the AI's to do, by saving the targets
it read as the new prescriptions through `workout_save_plan`. Nothing does it automatically.

`target_set` sets the caller's own target on one entry by hand, as a step: only what the entry's
rule moves (under double, reps inside its range and weight; under linear, the weight; under a
duration rule, seconds; under distance, distance and time at the same pace). Changing anything else
is a plan edit. A manual entry has no target to set — its numbers are the plan's. Reading or setting
an athlete's targets as their coach is not offered.

**Someone else's training** (#11) — `athlete_list` · `session_list` · `session_get` — is read
through the same tools. A member who shares their training with a group (`GLOSSARY.md`, "Share
training") is an **athlete** to its editors; `athlete_list` names them, each with the id that
`training_review`, `session_list`, `session_get` and `exercise_history` take as `athlete`
(`OfAthlete` in the contract) to read theirs instead of yours. Omitted, they read your own —
`session_list` and `session_get` are also how an AI reads your own sessions, notes and all.

Each is the athlete's own read, given their training — a `Training` the tool resolves once, with
`ownOrCoached`, as the HTTP route does — and the same function the route calls with it, so it
computes as the athlete's does, and differs only by what the
coach can see (ADR-0019). How each read treats what the coach cannot see is the rule it already
has: a session keeps every set and says "unavailable exercise"; the review **leaves out** the work
of an exercise or plan the coach cannot see, as it leaves out one you have lost; the history of
such an exercise is refused. Nothing a coach's AI can call writes to an athlete's training, and an
athlete who stops sharing is a refusal on the next call. See
`docs/adr/0021-coaching-through-groups.md`.

### 3. Diagnosing a running instance

`platform_status` · `db_slow_queries`

Honest about the value: during local development this adds nothing, because psql, the source and the
tests are right there. It earns its place when the instance belongs to **someone else** and there is
no shell — "it is slow on my NAS" is otherwise unanswerable. Curator-only.

`db_slow_queries` reads `pg_stat_statements`, which stores **normalised** statements: parameters are
`$1` placeholders, never literal values, so it cannot leak a user's data.

### 4. Nutrition, later

Recipes and meal planning will reuse the same shape — `recipe_*`, `meal_*` — over the same ownable
machinery. Nothing here needs to change to accommodate them.

## Curator rights

There is **no admin flag**. Being an **editor of the seeded `cedo` group** is the curator capability:
it grants writing to the shared library, reading diagnostics, and opening or closing sign-up.

**A fresh instance's first account is its curator** (ADR-0029): it joins the library as an editor,
and sign-up closes behind it. Every later account joins as a reader, and the library's members do
not change through the API at all (`docs/03-domain-model.md`).

An instance set up before that keeps the old way, now deprecated: `CEDO_CURATOR_USERNAME` names an
account the seed promotes to editor on every boot. Register the account first, then restart — the
server logs a warning if the name does not exist yet.

**Why this matters:** without a curator, nobody can edit the shared library at all. The system
account owns those rows but is not a member of the group.

The same rights gate `GET /admin/status` and `GET /admin/slow-queries`, which return exactly what
`platform_status` and `db_slow_queries` return — the AI and a person read the same numbers — and
`PATCH /instance` with its twin `instance_sign_up_set`: open sign-up while testers register, then
close it.

## Designing a tool

**A tool handler calls one service function and formats the result. It contains no domain logic.**
That is the same rule as an HTTP route handler, and for the same reason.

What formatting needs to read is not a second service call. A line names an exercise's or a
workout's owning group — `mine`, `library`, or the group's name (#47) — and the response carries
only `ownerGroupId`. So the tools that print those lines also call `groupNamesOf(caller)`
(`format-group.ts`). It reads the caller's own groups, which own everything they can see, and
decides nothing. The app does the same from the groups it already holds. Putting the name on
every ownable response instead would add a join to every list, for a word only these lines print.

### Task-shaped, not endpoint-shaped

Do not mirror the REST surface. `session_log` records a whole session — start, every set, finish —
in one call, because the alternative is `1 + N` round trips for one workout. There is no
`session_start`/`session_log_set`/`session_finish` triple, because no caller wants one.

A task-shaped tool is still ONE service call: `session_log` is `SessionService.logWhole`, one
transaction, all or nothing. It numbers the sets itself, per plan entry or exercise in the order
sent — the model sends no `setIndex`, and is refused if it does, so it cannot number them
differently from the app. Its first version looped over `logSet` inside the tool — domain logic
in a handler, and a failure part way left a session that was never finished, which the AI's
natural retry then logged a second time.

### Output size is the real cost

Not the number of calls. Forty exercises as raw JSON with nested media is tens of kilobytes of
context; the same information as one line each is a tenth of that.

- **Compact text** for anything the model reads.
- **JSON only** for what it must round-trip back into another tool. That is why
  `workout_get` returns an outline and `workout_get_editable` returns JSON in exactly the shape
  `workout_save_plan` expects — produced by the contract's `planInputFrom`, ids included, so an AI
  that edits a plan through this round trip keeps its logged history attached. See
  `docs/06-api.md`.

### What the model reads is in the person's unit; what it sends is in grams

Every weight in tool OUTPUT is formatted in the caller's `weightUnit` — "5 × 220.46 lb" for someone
who reads pounds — because the AI is writing for that person. Every weight in tool INPUT is grams,
whoever the caller is, as the schemas say: one unit to send in, so a model never has to guess which
one a number is in.

### Schemas come from the contract

`inputSchema` is the Zod schema from `@cedo/contract`, so the JSON Schema an AI reads is generated
from the same definition the database and the UI use. A closed set is a real `z.enum`, which is how
the model learns that `quadriceps` is valid and `quads` is not — a `z.string().refine()` would
validate identically and advertise nothing.

### A plan teaches its own model

An AI wrote "2–3 ramp sets first" in a cue and planned no warm-up sets, and ramped its reps in reserve per set
in a way progression then misjudged: the tools had told it nothing about either. So the plan's model
is said where the AI meets it, three ways (ADR-0026, ADR-0027):

- **Every field of the plan schema carries a description**, and a test fails on one that does not.
  They say what a warm-up set is — its own reps and weight, pre-filled in the logger, never judged,
  its weight following the working target in proportion (or as written, when the working sets have
  no positive weight); what each rule does and what its
  parameters mean; that the plan holds the prescription, where each follower starts, and never
  their target; and that reps in reserve is a floor each working set may ask for itself. And they
  say to write cues and notes in reps in reserve, never RPE.
- **Every long-text field says it is Markdown, and what of it is drawn** (`PROSE_WORDS`, ADR-0028):
  workout, session and athlete notes, an exercise's description and instructions. A cue says it is
  one line, with bold, italic and links only (`INLINE_PROSE_WORDS`).
- **Every state the contract refuses is refused with what to do instead**: under double, reps
  outside the range, or a range whose `from` is not below its `to`; under a rule, working sets that
  differ in what the rule moves or judges (reps in reserve may differ); an exercise's tracking mode
  changed (duplicate it instead); a rule that does not fit the
  exercise's tracking mode — weight or bodyweight and reps take manual, linear or double, duration
  manual or linear in seconds, distance and duration manual or distance; a half rep in reserve.
- **`workout_get` prints everything a rule depends on**: each rule in full (`double 8–12, +2.5 kg`,
  `linear +2.5 kg after 2 cleared sessions`), each set's reps in reserve, and the caller's target
  beside the prescription it started from. Read for an `athlete`, it prints no target: a coach
  reading an athlete's targets is not offered.

**How hard a set was is reps in reserve, everywhere.** Tools take it whole, none to five, and every line they
print says it the same way: `8 × 55 kg · 2 in reserve`. RPE is how the column stores it, and no tool
reads or writes it — the AI and the athlete read the same number by the same name. A target says
none: each set asks the plan's own, which no rule moves, so `next: 9 × 60 kg` beside a ramp of 2, 1
and 0 does not read as 2 for every set.

### Nothing can be deleted

There is no `*_delete` tool, and a test asserts none appears — not even for an athlete note (#41),
which the model may reword when it is no longer true, and a person removes; nor for a weigh-in
(#42), which a second that day replaces. Deletion is rare, hard
to undo, and a confused model destroying training history on a self-hosted box with no backup is a
far worse outcome than it failing to tidy up. Tidying stays a human action in the UI.

So `session_fix_set` (#31) corrects a set and never removes one: the app removes a set, or deletes
a session, behind a person's tap. A correction is still a write that replaces what was logged, so
it takes only your own sets, each by the id `session_get` shows beside it.

Every tool carries one of the four annotations in `mcp/format.ts`, so a client can gate
writes: `READ`; `WRITE`, which adds and replaces nothing; `REPLACES`, destructive and
idempotent, for a write that replaces what was there — a set corrected, a note reworded, that
day's weigh-in, the equipment list, a workout's notes; and `REWRITES`, destructive and not
idempotent, for `workout_save_plan`, which replaces the whole plan — a day or entry left out is
gone — and raises its version each time. A client that asks before a destructive write asks
at every plan save; that is the price of a save that can drop half a plan.

## Adding a tool

1. If it needs data the API cannot already produce, add a **service** function first — never put the
   logic in the tool.
2. Register it in `mcp/tools/library.ts`, `groups.ts`, `equipment.ts`, `training.ts`, `session.ts`,
   `coaching.ts`, `athlete-file.ts` or `diagnostics.ts` with a contract schema,
   an annotation, and a description written for a model: say when to use it, and what NOT to do. A
   new file must also be wired into `mcp/tools/index.ts`, or its tools never load.
3. Format the output for reading (`mcp/format.ts`), not for machines. A write answers with what
   it changed: the whole of it when that is small — `exercise_update` prints the exercise — and
   only the part that changed when the rest is large and untouched — `workout_update` prints the
   name and notes, not the plan beneath them.
4. Add a case to `mcp/mcp.test.ts`, which drives real JSON-RPC over HTTP rather than calling the
   handler directly — auth, framing and schema publication are exactly what a direct call skips.
