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

```bash
# create a token in Settings, then:
claude mcp add --transport http cedo https://<host>/api/mcp \
  --header "Authorization: Bearer <token>"
```

A **personal access token**, not a session token. The two are deliberately not interchangeable: a
PAT is long-lived and pasted into a client's config, a session belongs to a browser. Passing a
session token to `/mcp` is a 401, and a test asserts it.

## What it is for

Four objectives, and every tool exists to serve one of them.

### 1. Curating the exercise library

Reviewing and creating exercises from reliable sources, with correct muscle attribution.

`library_audit` · `exercise_search` · `exercise_get` · `exercise_create` · `exercise_update` ·
`media_add_link` · `muscle_list`

**The guardrail matters more than the capability.** The expensive failure is not a missing tool, it
is creating "Barbell Bench Press" beside an existing "Bench Press", or attributing muscles
inconsistently across similar movements. So `library_audit` reports near-duplicates (by the same
`pg_trgm` similarity that backs search), muscles with thin or no coverage, and entries missing
instructions or media. The tool descriptions tell the model to read before it writes.

Writing to the shared library requires **curator** rights (below). Anything else lands in the
caller's own group.

### 2. Reviewing someone's training

`training_review` · `workout_list` · `workout_get` · `workout_get_editable` · `workout_create` ·
`workout_save_plan` · `workout_duplicate` · `workout_progression` · `exercise_history` ·
`session_log`

`training_review` is the entry point, and it is a **read model, not new domain rules** — pure
aggregation over data the API already exposes. It exists because the alternative is the model paging
through every session and doing date arithmetic itself, which is slow, expensive in context, and a
reliable source of quiet errors. One call returns adherence (sessions per week, streak, longest
gap), which planned days are being skipped, volume per muscle against the preceding period, and
which exercises have stalled.

Volume per muscle is what the load percentages are **for**: `weight × reps × (load_pct / 100)`,
warm-ups excluded.

`workout_progression` returns what `nextTarget()` proposes — the same pure function the logging
screen uses, so the AI's advice and the app's hint can never diverge.

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
CEDO_ADMIN_USERNAME=valerio
```

The seed promotes that account to editor on every boot. Register the account first, then restart —
the server logs a clear warning if the name does not exist yet. Additional curators are added
through the ordinary group-members endpoint.

**Why this matters:** without it, nobody can edit the shared library at all. The system account owns
those rows but is not a member of the group, and registration only ever grants `reader`.

The same rights gate `GET /admin/status` and `GET /admin/slow-queries`, which return exactly what
`platform_status` and `db_slow_queries` return — the AI and a person read the same numbers.

## Designing a tool

**A tool handler calls one service function and formats the result. It contains no domain logic.**
That is the same rule as an HTTP route handler, and for the same reason.

### Task-shaped, not endpoint-shaped

Do not mirror the REST surface. `session_log` records a whole session — start, every set, finish —
in one call, because the alternative is `1 + N` round trips for one workout. There is no
`session_start`/`session_log_set`/`session_finish` triple, because no caller wants one.

### Output size is the real cost

Not the number of calls. Forty exercises as raw JSON with nested media is tens of kilobytes of
context; the same information as one line each is a tenth of that.

- **Compact text** for anything the model reads.
- **JSON only** for what it must round-trip back into another tool. That is why
  `workout_get` returns an outline and `workout_get_editable` returns JSON in exactly the shape
  `workout_save_plan` expects — produced by the contract's `planInputFrom`, ids included, so an AI
  that edits a plan through this round trip keeps its logged history attached. See
  `docs/06-api.md`.

### Schemas come from the contract

`inputSchema` is the Zod schema from `@cedo/contract`, so the JSON Schema an AI reads is generated
from the same definition the database and the UI use. A closed set is a real `z.enum`, which is how
the model learns that `quadriceps` is valid and `quads` is not — a `z.string().refine()` would
validate identically and advertise nothing.

### Nothing can be deleted

There is no `*_delete` tool, and a test asserts none appears. Deletion is rare, hard to undo, and a
confused model destroying training history on a self-hosted box with no backup is a far worse
outcome than it failing to tidy up. Tidying stays a human action in the UI.

Every tool carries `readOnlyHint` so a client can gate writes.

## Adding a tool

1. If it needs data the API cannot already produce, add a **service** function first — never put the
   logic in the tool.
2. Register it in `mcp/tools/<area>.ts` with a contract schema, an annotation, and a description
   written for a model: say when to use it, and what NOT to do.
3. Format the output for reading (`mcp/format.ts`), not for machines.
4. Add a case to `mcp/mcp.test.ts`, which drives real JSON-RPC over HTTP rather than calling the
   handler directly — auth, framing and schema publication are exactly what a direct call skips.
