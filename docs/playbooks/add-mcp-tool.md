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
    inputSchema: ExerciseCreate,          // the contract schema, never a new shape
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  // `text` and the formatters (`exerciseDetail`, `workoutDetail`, …) live in apps/api/src/mcp/format.ts
  async (input) => text(exerciseDetail(await ExerciseService.create(caller, input))),
)
```

The input schema comes from `@cedo/contract`. Redeclaring the shape is how the tool and the route
start accepting different things.

## 3. Format for an AI, not for a UI

Return compact text from `mcp/format.ts`, not JSON. A list of exercises as JSON is an order of
magnitude more tokens than `Barbell Back Squat (uuid) · quadriceps 45%, glute_max 30%`.

## 4. Say what it may not do

Every tool runs as a real user under the same ACL as the UI. There is no elevated path. Writing to
the shared library requires being a **curator** — an editor of the seeded `cedo` group — which
`requireCurator` enforces, and which answers `404`, not `403`.

## 5. Test it through the wire

`apps/api/src/mcp/mcp.test.ts` drives JSON-RPC over HTTP with a real personal access token. Nothing
reaches into the handler directly, because the parts most likely to break — auth, framing, schema
publication — are exactly what a direct call skips.

Cover at minimum: the happy path, a non-curator being refused, and one user's token not seeing
another user's data.
