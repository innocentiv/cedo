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
  | `index.ts`       | An Elysia instance: routes, schema bindings, `.guard({ auth: true })` | Any business logic |
  | `service.ts`     | All business logic. Functions taking `(caller, input)`; reads through visible relations | Any HTTP concept; a raw owned table |
  | `lifecycle.ts`   | The module's kind declared to the shared ownable lifecycle (`modules/ownable/`): its name, relation and hooks | A raw owned table — lint refuses it, as anywhere outside `db/` and `write*.ts` |
  | `write*.ts`      | The statements that change owned rows, and the guards that must share their transaction | A statement on an owned table without `editable()` |
  | `<concept>.ts`   | One part of the service, named for what it decides — `plan.ts`, `references.ts`, `loggable.ts`, `numbering.ts` — when the service grows past one file | Any HTTP concept; a raw owned table; a vague name |
  | `<name>.test.ts` | Unit + integration tests, colocated                           | —                  |

- **Never create a `utils.ts`.** Name the file after what it does (`password.ts`, `token.ts`).

## The service rule

A route handler and an MCP tool are both **at most five lines**, and both call the same service
function:

```ts
// modules/exercise/index.ts
.post('/', ({ caller, body }) => ExerciseService.create(caller, body),
      { body: ExerciseCreate, response: Exercise })

// mcp/tools/library.ts
server.registerTool('exercise_create',
  { title: 'Create an exercise', description: '…', inputSchema: ExerciseCreate, annotations: WRITE },
  async (input) => text(exerciseDetail(await ExerciseService.create(caller, input))))
```

If a rule exists in only one of those two paths, it is a bug. Put it in the service.

## The ACL invariant

Every owned table — an ownable (built with `ownable()`) or one of its children (`childOwner()`) — is
readable only through its owning group.

```ts
// reading — service.ts, through the visible relation
const exercises = visibleExercises(caller)
db.select().from(exercises).where(eq(exercises.id, id))

// writing — write.ts, with editable() on the statement itself
db.update(exercisesTable)
  .set(patch)
  .where(and(editable(exercisesTable, caller), eq(exercisesTable.id, id)))
```

**A read of an owned table that does not go through its visible relation is a data leak between
users.** Treat it as a security defect, not a style issue. Lint refuses the raw-table import outside
`db/`, `write*.ts` and tests, and `raw-sql.test.ts` refuses an owned table named in an `sql`
template; `review/diagnostics.ts` (instance-wide counts for a curator) is the one named exemption.
Every module must prove cross-user isolation — in its own test file, or, for an ownable kind, by
its entry in `KINDS` in `modules/ownable/ownable.test.ts` — and `test/membership-lost.test.ts`
needs a case for every new GET route or read-only MCP tool. See
[adr/0019](adr/0019-visible-relations.md).

Not-found and not-permitted both return **404**, never 403 — a 403 confirms the resource exists and
leaks its existence to a stranger.

## Errors

One envelope, everywhere:

```json
{ "error": { "code": "not_found", "message": "No such exercise", "details": null } }
```

`code` is a member of the `ErrorCode` union in `packages/contract/src/error.ts`, and the codes are
**generic, never per-resource** — `not_found`, not `exercise_not_found`. That is what lets a client
switch exhaustively over a fixed set; the resource is named in `message`. Adding
`workout_not_found` to the union breaks every exhaustive switch downstream, so a new case is a new
KIND of failure, not a new noun. Services throw typed domain errors;
a single `onError` handler maps them to status codes. Route handlers never construct responses for
errors.

## Units

All measurements are integers in base units — `weight_g`, `distance_mm`, `duration_s`. Never a
float, never a `numeric`, never kilograms in the database or on the wire.

**`packages/contract/src/units.ts` is the only file permitted to convert.** If you find yourself
writing `/ 1000` or `* 2.20462` anywhere else, stop and use a helper from that file.

Which unit a value is *typed* in — kg for a weight, metres for a distance — is decided once, in
`DIMENSION_FIELDS` (`packages/contract/src/dimension.ts`), which calls those helpers. A screen
renders a `DimensionInput` and never picks a unit or a label itself. See `docs/08-frontend.md`.

## Schemas

Author once, in Zod, in `packages/contract`. Never redeclare a shape in the API, the MCP tools, or a
form. If the API needs a variant, derive it (`.pick()`, `.omit()`, `.extend()`) from the canonical
schema rather than writing a parallel one.

Query-parameter schemas must use `z.coerce` — query strings are always strings — and a boolean
`z.stringbool()`, because `z.coerce.boolean()` reads the string "false" as true.

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

`check` **formats** as part of the run; `check:ci` verifies formatting instead and never writes.
Do not run the formatter after every individual edit: it rewrites the exact text your next edit is
trying to match, and neither the linter nor the compiler cares about formatting. See the working
notes in `CLAUDE.md`.
