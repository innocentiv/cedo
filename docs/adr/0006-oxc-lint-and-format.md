# 0006 — oxlint + oxlint-tsgolint + oxfmt

**Status:** Accepted (2026-08-23)

## Context

The project requires very strict linting to reduce bugs, and simultaneously requires a minimal
dependency footprint favouring well-established tools. Those pull in opposite directions: the
strictest rule set (typescript-eslint's type-aware rules) historically came with the largest
dependency graph and the slowest runs.

## Decision

Use the Oxc toolchain: `oxlint` for linting, `oxlint-tsgolint` for type-aware rules, `oxfmt` for
formatting.

## Why

As of 2026-07-22, type-aware linting in oxlint is stable, and `oxlint-tsgolint` implements **59 of
typescript-eslint's 61 type-aware rules** at 12–18× the speed. `oxfmt` passes 100% of Prettier's
JavaScript and TypeScript conformance tests. This removes the tradeoff entirely: maximal rule
coverage, three devDependencies, millisecond runs.

Verified during M0 by planting deliberate defects — `no-floating-promises` and
`no-unnecessary-condition` were both caught, and the run exited non-zero.

## Rejected

- **Biome 2.5.** Initially recommended, then rejected. One binary for lint and format is appealing,
  but its type-aware coverage lacks precisely the rules that catch real bugs in an async API
  codebase (`no-floating-promises`, `no-misused-promises`, the `no-unsafe-*` family). Once
  `oxlint-tsgolint` reached stability, Biome lost on rules while matching on dependency count.
- **ESLint 10 + typescript-eslint + Prettier.** The reference implementation and the most complete
  rule set, but roughly eight devDependencies, a flat-config file per workspace, and type-aware runs
  measured in seconds to minutes.

## Consequences

- `oxlint-tsgolint` **requires TypeScript 7.0+**, which forces [0007](0007-typescript-version-split.md).
- `oxfmt` is pre-1.0 (0.64.0). Formatting is the lowest-risk component to replace and its output is
  Prettier-compatible, so the exit path is a one-line script change.
- Warnings are configured to fail (`--deny-warnings`) so no ambient noise accumulates.

## Rules deliberately disabled

Strictness is only useful if every warning means something. These are off on purpose:

| Rule | Why |
| --- | --- |
| `typescript/prefer-readonly-parameter-types` | Demands a `readonly` annotation on essentially every destructured or object parameter. High ceremony, no bug-catching value, and it fires on idiomatic code. |
| `no-inline-comments` | This codebase deliberately annotates lines with short trailing comments. |
| `require-await` (base rule) | Duplicated by `typescript/require-await`, which is type-aware and more accurate. |
| `unicorn/no-null` | `null` is meaningful and load-bearing here: it distinguishes "explicitly absent" from "not provided" at the database and contract boundary. |

If you add a `// oxlint-disable` anywhere, add a line here explaining why, or fix the code instead.

### `no-redeclare`

Disabled outright. TypeScript keeps types and values in separate namespaces, so the canonical Zod
idiom is correct and unambiguous:

```ts
export const Exercise = z.object({ ... })
export type Exercise = z.output<typeof Exercise>
```

oxlint only ships the base ESLint rule, which has no TypeScript awareness, and it flagged 63 correct
declarations. There is no `typescript/no-redeclare` counterpart to switch to, so the rule is off.

### Relaxations for test files

`**/*.test.ts` and `**/e2e/**` turn off `no-non-null-assertion`, `max-lines-per-function`,
`no-await-in-loop` and `consistent-function-scoping`. Asserting a value is present is the point of a
test, `describe` blocks are legitimately long, and sequential awaits in a test are clearer than
`Promise.all`. These stay ON in application code.

### Justified inline disables

| Location | Rule | Why |
| --- | --- | --- |
| `apps/api/src/db/seed.ts` | `no-await-in-loop` | The library is seeded sequentially on purpose. Parallelising ~45 transactions would exhaust the small connection pool a self-hosted box runs with, for no benefit in a one-off script. |
| `packages/contract/src/primitives.ts` (`patchOf`) | `no-unsafe-type-assertion` | `Object.fromEntries` cannot produce a mapped type. The alternative — hand-writing each PATCH schema — is how an `.optional()` on a defaulted field reintroduces the reset-on-patch bug. `schema.test.ts` pins the runtime shape. |

Note that `oxlint-disable-next-line` targets the **immediately** following line. Put the
justification comment _above_ the directive, not between the directive and the code, or it silently
suppresses nothing.

### Files excluded from linting

`apps/api/drizzle.config.ts` — drizzle-kit requires it at the package root and runs it under Node,
so it sits outside the api tsconfig and has no type information for the type-aware rules to use.
It is type-checked separately by `apps/api/tsconfig.tools.json`.

`**/seed-data/**` relaxes `max-lines`: splitting the exercise library to satisfy a line count would
make it harder to read, not easier.

`ignorePatterns` is **not inherited through `extends`**, so `.oxlintrc.typeaware.json` carries its
own copy. Keep the two lists in sync.

### `**/mcp/tools/**`

`max-lines-per-function` and `max-lines` are off. A `registerTrainingTools` is a **list** of tool
registrations, not a function with logic in it — every entry is a declaration plus a handler that
delegates to a service in one line. Splitting it to satisfy a line count would scatter the tool
catalogue across files for no gain, exactly as with `seed-data`.

The rule that matters there is enforced by review, not the linter: **a tool handler calls one
service function and formats the result. It contains no domain logic.**
