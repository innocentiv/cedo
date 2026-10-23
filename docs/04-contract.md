# The contract

`packages/contract` is the only surface shared between the API and the app. Everything either side
knows about the other, it knows from here.

Its only dependency is `zod`. It must stay **isomorphic** — the same code runs in a browser, in Bun
on the server, and in React Native on a phone — and must compile under both TypeScript 7 and
TypeScript 6 (see [adr/0007](adr/0007-typescript-version-split.md)).

`isomorphic.test.ts` enforces this: it fails if any source file mentions `Bun.`, `process.`,
`require(`, a `node:` import, or a DOM global. That test exists because the package's tsconfig loads
Bun's types so the colocated tests can run — which would otherwise let a server-only global compile
here and crash on a device.

## One schema, four consumers

Author a shape once. Never redeclare it.

```ts
// packages/contract/src/exercise.ts
export const ExerciseCreate = ExerciseFields.superRefine(/* muscle loads sum to 100, … */)
// The request: the exercise, and where it goes — your group, or the shared library.
export const ExerciseCreateRequest = ExerciseCreate.safeExtend({ shared: z.boolean().default(false) })
export const Exercise = z.object({ id: Id, ...exerciseFields, canEdit: z.boolean(), ... })
```

```ts
// 1. HTTP route — apps/api/src/modules/exercise/index.ts (under `.guard({ auth: true })`)
.post('/', ({ caller, body }) => ExerciseService.create(caller, body),
      { body: ExerciseCreateRequest, response: Exercise })

// 2. MCP tool — apps/api/src/mcp/tools/library.ts: the same request, the same one service call
server.registerTool('exercise_create',
  { title: 'Create an exercise', description: '…', inputSchema: ExerciseCreateRequest, annotations: WRITE },
  async (input) => text(`Created.\n\n${exerciseDetail(await ExerciseService.create(caller, input))}`))

// 3. UI client — apps/app/src/api/client.ts. `ExerciseCreateRequestInput` is
//    `z.input<typeof ExerciseCreateRequest>`: what may be sent, before the schema's defaults fill
//    it in — the route's own body, so the two cannot drift.
create: (body: ExerciseCreateRequestInput) => POST('/exercises', Exercise, body)

// 4. OpenAPI — apps/api/src/plugins/openapi.ts
openapi({ mapJsonSchema: { zod: (s) => z.toJSONSchema(s, { io: 'input' }) } })
```

If a rule appears in one of those and not the others, it is a bug. Put it in the schema.


## Two fields are relative to the API, not to the site

`Media.url` and `Media.thumbnailUrl` are paths against the **API root** for an uploaded image
(`/media/:id/blob`), and absolute URLs for a link. The server cannot resolve them itself: the same
payload is read by a browser that reaches the API at `/api` behind Caddy and by a native build that
reaches it at an absolute host, so baking either in would pick one deployment.

A client resolves them with `apiUrl()` from `apps/app/src/api/http.ts`. Rendering `media.url`
straight into an `<img src>` asks the **web origin** for `/media/…`, which Caddy answers with the
SPA's own `index.html` — HTTP 200, `text/html`, a blank image and no error handler ever fires.

## Input schemas are strict; output schemas are not

```ts
export const ExerciseCreate = z.strictObject({ ... })   // rejects unknown keys
export const Exercise       = z.object({ ... })          // tolerates extra keys
```

**Strict inputs are an AI-safety property.** A mistaken tool call sending `{ nam: 'Bench' }` becomes
a loud validation error instead of an exercise with an empty name. This is the single cheapest guard
against a whole class of silent AI mistakes.

**Lenient outputs are a deployment property.** A server that gains a response field must not break
clients that have not been rebuilt.

## Invariants live in the schema, not in handlers

Anything that must be true of a shape is expressed with `superRefine`, so the API, the MCP tools and
the UI form all reject the same input with the same message:

```ts
// muscle loads must sum to 100, and no muscle may appear twice
export const ExerciseCreate = ExerciseFields.superRefine((value, ctx) =>
  checkMuscles(value.muscles, ctx),
)
```

Without this, a duplicate muscle would surface as a raw Postgres primary-key violation that no
caller can act on.

## Enums, not refinements

MCP publishes input schemas as JSON Schema, and that is how an AI discovers what values are legal.

```ts
export const MuscleSlug = z.enum(MUSCLE_SLUGS) // -> { enum: ["deltoid_anterior", ...] }
```

A `z.string().refine(...)` would validate identically and advertise nothing. Always use a real enum
for a closed set. `schema.test.ts` asserts the JSON Schema output contains every slug.

## Units

All measurements cross the wire as **integers in base units** — `weightG`, `distanceMm`,
`durationS`. Never a float, never kilograms.

`units.ts` is the only file permitted to convert. Screens call `formatWeight(grams, unit)` to show
a value and `DIMENSION_FIELDS` (`dimension.ts`) to type one; they never divide by 1000. So when
pounds arrived, the conversion changed in those two files alone; the rest of the work was carrying
the account's `weightUnit` to where values are shown — the account route, the MCP formatters, each
screen. Imperial distances would take the same path.

## Errors

One envelope for every failure:

```json
{ "error": { "code": "not_found", "message": "No such exercise", "details": null } }
```

`code` is a member of a closed union, so a client can switch exhaustively. Codes are generic
(`not_found`, not `exercise_not_found`) — the resource is named in `message`. There is deliberately
no `forbidden`: a resource the caller may not see returns `not_found`, because a 403 confirms it
exists.

## Contract drift, and how it surfaces

The frontend does not import the API's types (see [adr/0015](adr/0015-no-eden-treaty.md)). Agreement
is enforced from both ends instead:

- **Server side:** every integration test asserts `expectContract(schema, response)` using the same
  schema the client parses. The API cannot drift without a test failing.
- **Client side:** every response is parsed with its contract schema at runtime. A mismatch throws
  `ContractDriftError` naming the exact JSON path, which lands in `console.error`, which the
  `Bun.WebView` harness turns into a failed run with a screenshot.

This is strictly more protection than a shared type would give, because a shared type checks at
build time only and goes stale silently the moment the server is redeployed.

## Adding a field

1. Add it to the schema in `packages/contract`, with a default if it is optional.
2. Add the column and a migration (`docs/05-database.md`).
3. Read and write it in the service.
4. Add the client method's field — nothing to do if it is on an existing shape.
5. `bun run check`.

The type errors will lead you through steps 2–4. If they do not, something is typed as `any` and
that is the actual bug.
