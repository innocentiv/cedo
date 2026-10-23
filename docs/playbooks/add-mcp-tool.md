# Adding an MCP tool

A tool is **at most five lines** and calls the same service function the HTTP route calls. If you
find yourself writing domain logic in a tool handler, it belongs in `service.ts` — that is what makes
it impossible for the API and the AI to disagree about a rule. See `docs/07-mcp.md`.

## 1. Decide it is a tool at all

Tools exist for three jobs: curating the shared library from real sources, reviewing someone's
training, and diagnosing a running instance. A tool that does none of those is probably a route the
AI can already reach.

## 2. Register it

In `apps/api/src/mcp/tools/{library,training,diagnostics}.ts` — whichever task it serves. A new file
for a new area must also be registered in `apps/api/src/mcp/index.ts`, beside
`registerLibraryTools`, or none of its tools load.

```ts
server.registerTool(
  'exercise_create',
  {
    title: 'Create an exercise',
    description: '…what it does, and when NOT to use it',
    inputSchema: ExerciseCreateRequest,   // the contract schema the route takes, never a new shape
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  // `text` and the formatters (`exerciseDetail`, `workoutDetail`, …) live in apps/api/src/mcp/format.ts
  async (input) => text(`Created.\n\n${exerciseDetail(await ExerciseService.create(caller, input))}`),
)
```

The input schema comes from `@cedo/contract`, and it is the one the matching route takes.
Redeclaring the shape, or extending it in the tool, is how the tool and the route start accepting
different things. A field only the tool needs, like `shared` here, belongs in the contract's request
shape. Then the route accepts it too, and the one service call decides what it means.

## 3. Format for an AI, not for a UI

Return compact text from `mcp/format.ts`, not JSON. A list of exercises as JSON is an order of
magnitude more tokens than `Barbell Back Squat (uuid) · quadriceps 45%, glute_max 30%`.

## 4. Say what it may not do

Every tool runs as a real user under the same ACL as the UI. There is no elevated path. Writing to
the shared library requires being a **curator** — an editor of the seeded `cedo` group — which
`requireCurator` enforces, and which answers `404`, not `403`. Put that check in the service the
tool calls, as `review/diagnostics.ts` does, never in the tool: the HTTP route calls the same service,
and a check in one adapter is a check the other forgot.

A tool that turns an expected failure into a readable answer — "pg_stat_statements is not installed"
— catches THAT failure only, by its code. A blanket `catch` also turns a refusal into an ordinary
result, and the caller reads it as data.

## 5. Test it through the wire

`apps/api/src/mcp/mcp.test.ts` drives JSON-RPC over HTTP with a real personal access token. Nothing
reaches into the handler directly, because the parts most likely to break — auth, framing, schema
publication — are exactly what a direct call skips.

Cover at minimum: the happy path, a non-curator being refused, and one user's token not seeing
another user's data.
