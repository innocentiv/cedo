# Conventions

Follow these exactly. They exist so that code written months apart, by different sessions, reads as
though it were written at once.

## Files and naming

- **File names are `kebab-case.ts`.** Enforced by `unicorn/filename-case`.
- **Types and schemas are `PascalCase`**; values and functions are `camelCase`; database columns are
  `snake_case`; TypeScript properties mapping to them are `camelCase` (Drizzle bridges the two).
- **One module per domain area**, at `apps/api/src/modules/<name>/`:

  | File             | Contains                                                      | Must not contain   |
  | ---------------- | ------------------------------------------------------------- | ------------------ |
  | `index.ts`       | An Elysia instance: routes, schema bindings, `{ auth: true }` | Any business logic |
  | `service.ts`     | All business logic. Pure-ish functions taking `(ctx, input)`  | Any HTTP concept   |
  | `<name>.test.ts` | Unit + integration tests, colocated                           | —                  |

- **Never create a `utils.ts`.** Name the file after what it does (`password.ts`, `token.ts`).

## The service rule

A route handler and an MCP tool are both **at most five lines**, and both call the same service
function:

```ts
// modules/exercise/index.ts
.post('/exercises', ({ body, ctx }) => ExerciseService.create(ctx, body),
      { auth: true, body: ExerciseCreate, response: Exercise })

// mcp/tools/exercise.ts
server.registerTool('exercise_create',
  { description: 'Create an exercise', inputSchema: ExerciseCreate },
  async (input) => textResult(await ExerciseService.create(ctx, input)))
```

If a rule exists in only one of those two paths, it is a bug. Put it in the service.

## The ACL invariant

Every ownable table (anything built with `ownable()`) is readable only through its owning group.

```ts
// reading — ALWAYS
db.select()
  .from(exercises)
  .where(and(visible(exercises, ctx), eq(exercises.id, id)))

// writing — ALWAYS
db.update(exercises)
  .set(patch)
  .where(and(editable(exercises, ctx), eq(exercises.id, id)))
```

**A query on an ownable table that omits `visible()` or `editable()` is a data leak between users.**
Treat it as a security defect, not a style issue. Every module's test file must contain a
cross-user isolation test proving it.

Not-found and not-permitted both return **404**, never 403 — a 403 confirms the resource exists and
leaks its existence to a stranger.

## Errors

One envelope, everywhere:

```json
{ "error": { "code": "exercise_not_found", "message": "No such exercise", "details": null } }
```

`code` is a member of the `ErrorCode` union in `packages/contract/src/error.ts` — add to the union
when adding a case, so the client can exhaustively switch on it. Services throw typed domain errors;
a single `onError` handler maps them to status codes. Route handlers never construct responses for
errors.

## Units

All measurements are integers in base units — `weight_g`, `distance_mm`, `duration_s`. Never a
float, never a `numeric`, never kilograms in the database or on the wire.

**`packages/contract/src/units.ts` is the only file permitted to convert.** If you find yourself
writing `/ 1000` or `* 2.20462` anywhere else, stop and use a helper from that file.

## Schemas

Author once, in Zod, in `packages/contract`. Never redeclare a shape in the API, the MCP tools, or a
form. If the API needs a variant, derive it (`.pick()`, `.omit()`, `.extend()`) from the canonical
schema rather than writing a parallel one.

Query-parameter schemas must use `z.coerce` — query strings are always strings.

## Async

Type-aware linting rejects floating promises. Every promise is awaited, returned, or explicitly
discarded with `void`. There is no exception to this.

## Comments

Comment _why_, not _what_. A comment that restates the code is noise; a comment explaining a
non-obvious constraint, a workaround, or a decision is valuable. Link to the ADR when a line exists
because of a decision: `// see docs/adr/0018-n1-detection.md`.

## Before you commit

```bash
bun run check
```

It must exit 0. Warnings are failures — there is deliberately no ambient warning noise in this
repository, so that any warning means something.
