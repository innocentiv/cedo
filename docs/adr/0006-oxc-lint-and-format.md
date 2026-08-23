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

| Rule                                         | Why                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typescript/prefer-readonly-parameter-types` | Demands a `readonly` annotation on essentially every destructured or object parameter. High ceremony, no bug-catching value, and it fires on idiomatic code. |
| `no-inline-comments`                         | This codebase deliberately annotates lines with short trailing comments.                                                                                     |
| `require-await` (base rule)                  | Duplicated by `typescript/require-await`, which is type-aware and more accurate.                                                                             |
| `unicorn/no-null`                            | `null` is meaningful and load-bearing here: it distinguishes "explicitly absent" from "not provided" at the database and contract boundary.                  |

If you add a `// oxlint-disable` anywhere, add a line here explaining why, or fix the code instead.
