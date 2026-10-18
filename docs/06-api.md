# The API

Elysia on Bun. Routes validate with the Zod schemas from `@cedo/contract` and delegate immediately
to a service. Nothing else lives in a route file.

```
src/
  app.ts              composition root: the error handler, /health, and every module
  index.ts            entrypoint: migrate, seed the library, then listen
  env.ts              Zod-validated environment; refuses to boot if invalid
  plugins/auth.ts     the `auth` macro — resolves the caller in ONE query
  plugins/openapi.ts  spec generation from Zod
  lib/                error, password, token, keyset (cursors, LIKE escaping), media, storage/
  modules/<name>/     index.ts (routes) + service.ts (logic) + <name>.test.ts
```

## Route shape

```ts
export const groupRoutes = new Elysia({ prefix: '/groups', tags: ['groups'] })
  .use(authPlugin)
  .guard({ auth: true })
  .post('/', ({ caller, body }) => GroupService.create(caller, body), {
    body: GroupCreate,
    response: GroupMembership,
  })
```

A handler is at most five lines and calls exactly one service function. The same service function
backs the MCP tool. If a rule exists in only one of those paths, it is a bug — see
`docs/02-conventions.md`.

`.guard({ auth: true })` applies authentication to every route in the instance. Individual routes
can opt in with `{ auth: true }` instead.

## Authentication

Opaque bearer tokens. Only `sha256(token)` is stored, so a database leak yields nothing usable and
a token can be revoked by deleting its row — which is why these are not JWTs.

```
Authorization: Bearer <token>
```

**Sessions and personal access tokens are separate credentials.** A PAT authenticates MCP at
`/mcp`; it is not accepted on the HTTP API, and a session token is not accepted by MCP. That
separation is asserted by a test.

### The auth macro resolves the caller in one query, before validation

It runs on every authenticated request, so it joins sessions → users → group_members and aggregates
memberships in JavaScript. One round trip. Looking up the session and then fetching memberships
would be two, on every request. `bun run perf` asserts the count stays at one.

**Authentication happens in `transform`, not `resolve` — do not "simplify" it back.** Elysia runs
`transform` *before* schema validation and `resolve` *after* it. With the check in `resolve`, an
anonymous caller sending a malformed body got a 422 telling them their body was wrong, when the real
answer was that they were not signed in.

The resolved caller is handed from `transform` to `resolve` through a `WeakMap` keyed on the request
object. That indirection is load-bearing for two reasons: it keeps authentication at exactly one
query, and it leaves the context type inferable — annotating the context parameter directly breaks
`caller`'s type in every handler in the API.

A regression test asserts an anonymous POST with an invalid body returns 401, not 422.

Handlers receive:

```ts
caller: {
  userId, username, displayName, personalGroupId,
  groupIds,        // every group the caller belongs to
  editorGroupIds,  // the subset they may write to
}
```

`groupIds` and `editorGroupIds` are what `visible()` and `editable()` consume. There is no way to
read an ownable table without a caller.

### Sign-in does not leak which usernames exist

An unknown username and a wrong password produce byte-identical responses, and an unknown username
still spends the time of a real argon2 verification (`burnTime`) so latency does not reveal the
difference either. A test asserts both.

## Errors

One envelope, produced by a single `onError` handler. Handlers never build an error response.

```json
{ "error": { "code": "not_found", "message": "No such exercise", "details": null } }
```

| Situation | Code | Status |
| --- | --- | --- |
| Schema rejected the input | `validation_failed` | 422 |
| Body could not be parsed at all | `validation_failed` | 400 |
| Missing or invalid credentials | `unauthenticated` | 401 |
| Missing, **or present but not yours** | `not_found` | 404 |
| Duplicate, or a rule that forbids the change | `conflict` | 409 |
| Anything unhandled | `internal` | 500 |

`ERROR_CODES` also reserves `payload_too_large` (413), `unsupported_media_type` (415) and
`rate_limited` (429). No service throws them yet; they are in the union so a client's exhaustive
switch does not break the day one is.

Services throw the typed helpers in `lib/error.ts` (`notFound`, `conflict`, `unauthenticated`,
`invalid`). There is deliberately no `forbidden`.

**Validation details never echo the submitted value.** Elysia's `ValidationError.all` carries the
input on every issue, which on a registration includes the plaintext password; only `path` and
`message` are ever returned. A test asserts a distinctive password never appears in a 422 body.

## Nested resources: replace, do not patch

`PUT /workouts/:id/plan` replaces the **entire** nested plan — days, entries and sets — in one
transaction. There is deliberately no per-day or per-entry endpoint.

Granular CRUD over three levels would need reorder endpoints, index-collision handling, and a
partial-failure story for each. A transactional replace is one endpoint, one MCP tool, atomic
reordering, and it matches how an editor actually works: the client holds the whole plan and saves
it.

**Inputs carry no indices.** Order is array position and the server assigns `index`, which removes
duplicate and gap indices as a category. A client that sends `index` gets a 422 — the input schemas
are strict.

**Inputs may carry ids, and a save keeps what they name.** A replace is a replace of the plan's
*content*, not of its identity. Logged history hangs off day and entry ids — a session names its
day, progression reads the logs of an entry — through `ON DELETE SET NULL`, so the first version,
which deleted and re-inserted everything, severed all history on every save: renaming a day reset
every progression to zero sessions. Now `planInputFrom(workout)` (in the contract) produces the
round-trip shape with ids; days and entries sent back with their id are updated in place, and only
what the plan no longer holds is deleted. The ids are a hint, never trusted: one that is not part of
*this* workout is a new row, and an entry whose exercise changed is a new entry, so a plan can
neither take over another workout's rows nor inherit another exercise's history. The write is a
constant number of statements whatever the plan's size — `writePlan` in
`modules/workout/write-plan.ts`.

What the replace checks before touching anything, all inside its transaction:

- The caller must be able to **edit** the workout, under a row lock (`for update`) — checked
  outside the transaction, a co-editor transferring the workout away between the check and the
  write let someone who had just lost access replace the whole plan.
- The exercises must pass the one rule for what a plan may use where it lives —
  `assertPlanCanUse` in `modules/workout/references.ts`, which transfer and duplicate apply too, so
  no route can put an "Unavailable exercise" row in front of anyone. Every exercise must be
  **visible** to the caller (an id they cannot see is a 404, as if it did not exist); in a shared
  group, it must also be readable by the members now and later: owned by that group or by the
  starter library. Checked against the owner read under the lock.

Either way a rejected replace leaves the previous plan exactly as it was. A test asserts that.

## The route list lives in the spec, not here

`/openapi` is generated from the same Zod schemas the routes validate with, so it cannot drift.
Enumerating routes in this file would only give a second version to forget to update.

## Diagnostics

`GET /admin/status` and `GET /admin/slow-queries` are the HTTP twins of the `platform_status` and
`db_slow_queries` MCP tools, and call the same functions in `modules/review/diagnostics.ts`. There
is deliberately no version of this that an AI can see and a person cannot.

Both require a **curator** — an editor of the seeded `cedo` group, see `docs/07-mcp.md` — and answer
`404` rather than `403` to anyone else: whether an instance has a curator at all is not something an
ordinary caller needs to learn.

`pg_stat_statements` stores normalised statements (`$1` placeholders, never literal values), so the
slow query log cannot disclose anyone's data. This exists for one situation: someone self-hosting
reports that it is slow and there is no shell to log into. See `docs/10-testing.md`.

## Pagination and scope

List endpoints take `PaginationQuery` (`cursor`, `limit` ≤ 100). The ownable lists — exercises and
workouts — also take a `scope`; sessions are personal, so `GET /sessions` filters by `workoutId` and
`since` instead:

| Scope | Means |
| --- | --- |
| `all` | everything visible to the caller |
| `mine` | the caller's personal group only |
| `favourites` | pinned by the caller |
| `group` | one group; requires `groupId` |

Query schemas must use `z.coerce` — query strings are always strings.

## OpenAPI

Served at `/openapi` (Scalar UI) and `/openapi/json`.

`mapJsonSchema` is **required**: Elysia's native validator is TypeBox, and without it every
Zod-validated route documents as an empty object. A test asserts real field names reach the spec.

`createOpenapiPlugin()` is a factory, not a shared constant. The plugin registers the UI as a static
`Response`, whose body can be read only once — a module-level singleton works until something
requests `/openapi`, after which every later `createApp()` throws `ERR_BODY_ALREADY_USED`. Since
the tests build an app per test, that made `createApp()` silently non-reusable.

## Adding a module

1. Add the schemas to `packages/contract`.
2. `modules/<name>/service.ts` — all the logic, taking `(caller, input)`. Read owned tables only
   through their visible relations (`db/visible.ts`); put the statements that change them in
   `modules/<name>/write.ts`, each carrying `editable()`. See `docs/02-conventions.md`.
3. `modules/<name>/index.ts` — routes binding the schemas, each delegating in one line.
4. `.use(...)` it in `app.ts`.
5. `modules/<name>/<name>.test.ts` — including a cross-user isolation test, and `expectContract` on
   every response. A new GET route needs a case in `test/membership-lost.test.ts`, which fails
   until it has one.
6. An MCP tool wrapping the same service function (`docs/07-mcp.md`).
7. `bun run check`.
