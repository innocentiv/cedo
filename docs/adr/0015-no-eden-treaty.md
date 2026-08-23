# 0015 — No Eden Treaty; a contract-typed fetch client instead

**Status:** Accepted (2026-08-23)

## Context

Eden Treaty is Elysia's headline feature: `treaty<App>()` derives a fully typed client from the
server's route types, giving end-to-end type safety with no hand-written client code. It is the
obvious default for an Elysia project.

It requires the frontend to do this:

```ts
import type { App } from '@cedo/api'
```

## Decision

Do not use Eden Treaty in `apps/app`. The frontend depends only on `packages/contract` and uses a
small hand-written `fetch` client (~40 lines of shared helpers plus one 2-line method per endpoint)
that parses every response with its contract schema.

Eden Treaty **is** still used inside `apps/api`'s own tests, where `treaty(app)` wraps the app
instance. That is a devDependency of the API and crosses no boundary.

## Why

1. **It is a crossing dependency.** `apps/app` would type-depend on the entire `apps/api` source
   graph — Drizzle, Postgres, the MCP SDK. The frontend could not type-check unless the whole
   backend compiled. This directly violates the project's separation principle.
2. **It spans a TypeScript version boundary.** Per [0007](0007-typescript-version-split.md), the app
   is on TypeScript 6 and the API on TypeScript 7. Eden's deep conditional-type inference across
   that boundary is precisely the fragile case.
3. **A known bug makes it fail quietly.** elysiajs/eden#215: Treaty can degrade to `any` when the
   `App` type is imported across a package boundary. The failure mode is silent loss of type safety.
4. **It offers no runtime guarantee.** If the API's response shape changes, Eden's types go stale
   until something rebuilds. Nothing fails at runtime; the UI just quietly receives the wrong shape.

The replacement is strictly better on the last point. Because the client parses each response with
the same schema the API validates against, drift becomes a loud, located runtime failure
(`ContractDriftError`, naming the exact JSON path) — which the `Bun.WebView` harness captures and
surfaces to whoever is iterating. See [0017](0017-webview-for-ui-verification.md).

## Cost accepted

Roughly thirty hand-written two-line client methods, which can drift from the API. Mitigated by:

- `expectContract(schema, data)` asserted on **every** response in the API's integration tests, using
  the same schema the client parses.
- `ContractDriftError` failing loudly at runtime rather than corrupting state silently.
- A rule that every client method must be exercised by at least one UI journey — an unexercised
  method is the only real blind spot in this design.

## Enforcement

`apps/app/.oxlintrc.json` sets `no-restricted-imports` on `@cedo/api` and relative paths reaching
into it. `bun run lint` fails on violation.
