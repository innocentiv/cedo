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

Writing to the shared library requires **curator** rights (below). Anything else lands in the
caller's own group — and `exercise_duplicate` is how an AI adapts a library exercise for someone
without them: a copy in a group they edit, as `workout_duplicate` is for a shared workout.

### 2. Reviewing someone's training

`training_review` · `workout_list` · `workout_get` · `workout_get_editable` · `workout_create` ·
`workout_save_plan` · `workout_duplicate` · `workout_progression` · `exercise_history` ·
`session_log` · `session_fix_set` · `note_list` · `note_create` · `note_update` · `weigh_in_list` ·
`weigh_in_create` · `athlete_profile_set`

`note_list`, `note_create` and `note_update` (`mcp/tools/athlete-file.ts`) are **athlete notes** (#41,
`GLOSSARY.md`): what is known about someone, kept for planning their training — an injury, a
preference, what they said of a plan. Each takes the coaching tools' `athlete`: a coach writes them
too (ADR-0021, amended). `training_review` and the plan-writing tools say to read them first; the
review does not carry them, so a plan made without asking is the model's omission, not a stale
payload. Only the author rewords one, and none is removed here — the app does that, behind a tap.

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
or a session is not among them: see "Nothing can be deleted".

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
latest two sessions or more — and **effort drift** — the latest top set rated at least one RPE harder
in each of the latest two sessions than on average before them. Each session must cross the line on
its own, so one hard set or one bad day says nothing: self-rated RPE is off by about one.

The two read different things, so one cause is never said twice. Falling is estimated from what was
**lifted**, the reserve left out: counted, the same set rated half a point harder each time would
read as a fall made of rating noise. That is drift's to say, and drift needs RPE said both before and
since. A heavier set is harder by its load and is not compared, so drift goes quiet the session the
load goes up. A bodyweight lift has no estimated max, so it can drift but cannot fall. Each section
appears only when it has something to say:

```
Falling (estimated max from what was lifted, down 2+ sessions running):
  Bench Press: down in each of the latest 3 sessions, 77 kg → 66.5 kg

Effort drift (RPE up 1+ at the same set, in each of the latest 2 sessions):
  Row at 8 × 50 kg: average RPE 7 → 8.5
```

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

`workout_progression` returns what `progress()` proposes over every session so far — the same pure
function that pre-fills the app's logger (`GET /sessions/:id/targets`), over the sessions before
the one being logged. So the two agree whenever no session is in progress, and differ during one
only by the sets it has logged: the AI already counts them, the logger waits for the next session.
Both judge and answer in weights the athlete can load (#36, `nextLoadableTarget`), and
`workout_get` keeps the plan's weights as written, a set the athlete cannot load as written
followed by `(loads 22 kg)` — or `, the heaviest` — for them, or for `athlete`.

Each target is said with its RPE, a ceiling (#45), and each hold with its reason: `— held: short
of the targets`, or `— held for effort: a working set at RPE 10, past RPE 8`. The second is not a
stall, and no reason to deload: the reps were there, done harder than prescribed. `progress()` is
what gives the reason; see [adr/0012](adr/0012-progression-rules.md).

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
it grants writing to the shared library and reading diagnostics.

```
CEDO_CURATOR_USERNAME=valerio
```

The seed promotes that account to editor on every boot. Register the account first, then restart —
the server logs a clear warning if the name does not exist yet. It is the only way to make a
curator: every account is already a reader of the library, there is no role change, and its members
do not change through the API at all (`docs/03-domain-model.md`).

**Why this matters:** without it, nobody can edit the shared library at all. The system account owns
those rows but is not a member of the group, and registration only ever grants `reader`.

The same rights gate `GET /admin/status` and `GET /admin/slow-queries`, which return exactly what
`platform_status` and `db_slow_queries` return — the AI and a person read the same numbers.

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

### Nothing can be deleted

There is no `*_delete` tool, and a test asserts none appears — not even for an athlete note (#41),
which the model may reword when it is no longer true, and a person removes; nor for a weigh-in
(#42), which a second that day replaces. Deletion is rare, hard
to undo, and a confused model destroying training history on a self-hosted box with no backup is a
far worse outcome than it failing to tidy up. Tidying stays a human action in the UI.

So `session_fix_set` (#31) corrects a set and never removes one: the app removes a set, or deletes
a session, behind a person's tap. A correction is still a write that replaces what was logged, so
it takes only your own sets, each by the id `session_get` shows beside it.

Every tool carries `readOnlyHint` so a client can gate writes.

## Adding a tool

1. If it needs data the API cannot already produce, add a **service** function first — never put the
   logic in the tool.
2. Register it in `mcp/tools/library.ts`, `groups.ts`, `equipment.ts`, `training.ts`, `session.ts`,
   `coaching.ts`, `athlete-file.ts` or `diagnostics.ts` with a contract schema,
   an annotation, and a description written for a model: say when to use it, and what NOT to do. A
   new file must also be wired into `mcp/tools/index.ts`, or its tools never load.
3. Format the output for reading (`mcp/format.ts`), not for machines.
4. Add a case to `mcp/mcp.test.ts`, which drives real JSON-RPC over HTTP rather than calling the
   handler directly — auth, framing and schema publication are exactly what a direct call skips.
