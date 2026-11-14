# Adding an MCP tool

A tool is **at most five lines** and calls the same service function the HTTP route calls. If you
find yourself writing domain logic in a tool handler, it belongs in `service.ts` — that is what makes
it impossible for the API and the AI to disagree about a rule. See `docs/07-mcp.md`.

## 1. Decide it is a tool at all

Tools exist for three jobs: curating the shared library from real sources, reviewing someone's
training, and diagnosing a running instance. A tool that does none of those is probably a route the
AI can already reach.

## 2. Register it

In `apps/api/src/mcp/tools/{library,equipment,training,session,coaching,athlete-file,groups,diagnostics,instance}.ts` — whichever
task it serves. A new file
for a new area must also be registered in `apps/api/src/mcp/tools/index.ts`, beside
`registerLibraryTools`, or none of its tools load.

```ts
server.registerTool(
  'exercise_create',
  {
    title: 'Create an exercise',
    description: '…what it does, and when NOT to use it',
    inputSchema: ExerciseCreateRequest,   // the contract schema the route takes, never a new shape
    // READ, WRITE, REPLACES or REWRITES, from apps/api/src/mcp/format.ts — never a new object
    // here. REPLACES and REWRITES replace what was there, so a client asks first; see 07-mcp.md.
    annotations: WRITE,
  },
  // `text` and the formatters (`exerciseDetail`, `workoutDetail`, …) live in apps/api/src/mcp/format*.ts.
  // `detail` names the owning group: the one read a formatter's words need is the tool's to make
  // (`tools/group-names.ts`), never the formatter's.
  async (input) => text(`Created.\n\n${await detail(await ExerciseService.create(caller, input))}`),
)
```

The input schema comes from `@cedo/contract`, and it is the one the matching route takes as its
body. Redeclaring that shape is how the tool and the route start accepting different things. So is
extending it with a field the body lacks: a field like `shared` here belongs in the contract's
request shape, so the route accepts it too, and the one service call decides what it means. The one
legitimate extension is what the route takes from its PATH. `exercise_update`, for example, is
`ExerciseUpdate.safeExtend({ exerciseId })`, because `PATCH /exercises/:id` carries the id in the
URL.

## 3. Format for an AI, not for a UI

Return compact text from `mcp/format.ts` — or a `format-<area>.ts` beside it, as coaching's is — not JSON. A list of exercises as JSON is an order of
magnitude more tokens than
`Barbell Back Squat | barbell + rack | quadriceps 45%, gluteus_maximus 30% | [library, read-only] | <id>`.

A formatter is a contract value in, text out, and reads nothing: a handler is one service call and
one formatter, with no text of its own. A format file may import the contract, its sibling format
files and nothing that loads the database — `mcp/format-imports.test.ts` fails on one that does. A
count is said with the contract's `counted` ("1 session", never "1 sessions" or "session(s)"), and
an exercise the reader cannot see with its `exerciseName`.

## 4. Say what it may not do

Every tool runs as a real user under the same ACL as the UI. There is no elevated path. Writing to
the shared library requires being a **curator** — an editor of the seeded `cedo` group — which
`requireCurator` enforces, and which answers `404`, not `403`. Put that check in the service the
tool calls, as `review/diagnostics.ts` does, never in the tool: the HTTP route calls the same service,
and a check in one adapter is a check the other forgot.

A tool that turns an expected failure into a readable answer — "pg_stat_statements is not installed"
— catches THAT failure only, by its code. A blanket `catch` also turns a refusal into an ordinary
result, and the caller reads it as data.

## 5. Test what it says where it is written, and the tool through the wire

Two kinds of test, for two things.

**What it says** is tested in the formatter's own file — `mcp/format-library.test.ts` beside
`format-library.ts` — by calling it: a contract value in, the text out, with no wire and no
database. Build the value by hand and parse it with the contract's schema, so the fixture cannot
drift from the contract. Assert a formatter's main cases as the whole text, a line an element, as
the model reads them; a fragment matched with `toContain` is how "1 sessions" stayed pinned. Take
the expected text from somewhere other than the formatter — its doc comment, the contract's test of
a line it borrows, the fixture's numbers worked by hand — and cover every branch: the empty answer,
the singular, the thing out of reach.

**The tool** is tested through the wire. `apps/api/src/mcp/mcp.test.ts` drives JSON-RPC over HTTP
with a real personal access token. Nothing reaches into the handler directly, because the parts most
likely to break — auth, framing, schema publication — are exactly what a direct call skips. An area
with many cases gets its own file beside it, as `mcp/progression.test.ts` does, with the same wire
from `apps/api/src/test/mcp-wire.ts`. The wire is for what only the wire shows: that the tool is
published, by name, with its schema and annotation; that it reaches its service and answers with
its formatter's text — one line that could be no other tool's is enough; what it hands the
formatter that a hand-built value would not prove — the caller's unit, their equipment, their
groups' names, whose training it is; and a refusal, checked by `isError`, not by a word found
somewhere in the reply. It does not repeat the formatter's cases: a rule's words tested through
JSON-RPC, an access token, a service and Postgres cost thirty-six calls of setup for three lines.

What a tool reads for someone else is decided in the service it calls — except where only the tool
combines two reads: `workout_get` adds the caller's own targets to a plan, and leaves them out when
it is read for an `athlete`, since no route reads a plan and targets together.

Cover at minimum: the happy path, a non-curator being refused, and one user's token not seeing
another user's data.
