# 0007 — TypeScript 7 on the server, TypeScript 6 in the Expo app

**Status:** Accepted (2026-08-23)

## Context

TypeScript 7.0 (the Go-native compiler) has been stable since 2026-07-08 and is 8–12× faster.
`oxlint-tsgolint`, which provides our type-aware lint rules, **requires TypeScript 7.0+**.

Expo SDK 57's template pins `typescript@~6.0.3`, and Expo does not support TypeScript 7 — support is
expected in TypeScript 7.1. This was confirmed with the user rather than discovered by experiment.

## Decision

- `packages/contract` and `apps/api` use **TypeScript 7.0.2** and get full type-aware linting.
- `apps/app` pins **`typescript@6.0.3`** exactly (Expo's template says `~6.0.3`; `bunfig.toml`
  installs exact versions everywhere) and gets oxlint's non-type-aware rules only.
- The root solution `tsconfig.json` deliberately does **not** reference `apps/app`.

## Why

Type-aware rules are most valuable exactly where TypeScript 7 is available: the server, which is
where async correctness, unsafe `any` flow and exhaustiveness actually cause data bugs. The frontend
holds almost no domain logic by design (invariant 7 in `CLAUDE.md`), so the weaker rule set there
costs little.

Waiting for Expo to support TypeScript 7 would mean giving up type-aware linting on the server for
months, which is the wrong trade.

## Consequences

- Two compiler versions coexist. `bun run typecheck` runs `tsc -b .` for the server and a separate
  `tsc --noEmit` inside `apps/app`.
- `bun run lint` is likewise split: `.oxlintrc.typeaware.json` for the server,
  the base `.oxlintrc.json` for the app.
- `packages/contract` must stay compilable under **both** compilers, since the app consumes it. Keep
  it to plain Zod and plain functions; no TypeScript 7-only syntax.

## Revisit when

Expo supports TypeScript 7.1. Then unify on one version, reference `apps/app` from the root
solution, and collapse the split lint scripts into one.
