# Frontend

Expo SDK 58 / React Native 0.88 / React 19.3, with `expo-router`. Web-mobile-first, plus a tablet
two-pane layout. It depends on **`@cedo/contract` and nothing else** from this repo.

## The thinness rule

This is the rule the whole frontend is organised around, and the reason the test suite can be as
small as it is.

> A screen **may**: call the hooks in `src/api/queries.ts` (never `api.*` or `fetch` directly),
> render UI primitives, hold form state, and call pure helpers from `@cedo/contract`
> (`formatEffort`, `formatWeight`, `formatPrescription`, `workingSetsDone`, `planInputFrom`).
>
> A screen **may not**: perform unit arithmetic, sum muscle loads, decide progressions, hand-format
> measurements, or branch on domain rules. If a screen needs a rule, the rule belongs in the
> contract, where it is unit-tested with no DOM.
>
> No raw `<View>`, `<Text>` or `StyleSheet` in a screen file. No literal colour or pixel value
> anywhere outside `src/ui/tokens.ts`.

Every behaviour is proven on the backend (`docs/10-testing.md`). If a screen grows logic worth
testing, that is the signal it belongs somewhere else.

A screen that would join several reads to decide one thing asks for the answer instead. The live
session screen joined the session, its workout and its progression, and took a plan it failed to
FETCH for one out of reach — offering the logger of a session without a plan, whose next set went
into the wrong series. `GET /sessions/:id` now answers with the plan as the reader can reach it
(`SessionPlan`), each entry's done count included, and the screen renders that.

## The dependency boundary

`apps/app` must never import from `apps/api` — not even a type. This is enforced, not merely
agreed: `apps/app/.oxlintrc.json` sets `no-restricted-imports` on `@cedo/api` and on any relative
path that climbs into it, so a violation fails `bun run lint`.

The rule holds for test helpers too. The end-to-end harness needs a running API, and it starts one
as a **subprocess** rather than importing `createApp`. The two halves meet over HTTP exactly as they
do in production. See `docs/01-architecture.md`.

## Layout

```
app/_layout.tsx              ErrorBoundary > SafeAreaProvider > QueryClient > AuthProvider > Slot
app/index.tsx                the only cold-start redirect
app/(auth)/_layout.tsx       bounces a signed-in visitor out
app/(auth)/login.tsx  register.tsx
app/(app)/_layout.tsx        the signed-in shell: bottom bar on phone, sidebar on tablet

app/(app)/today/            index · session/[id]        the live logging screen
app/(app)/workouts/         index · [id]/index · [id]/edit
app/(app)/exercises/        index · new · [id]/index · [id]/edit
app/(app)/settings/         index · groups · tokens

src/ui/                      the entire visual vocabulary
src/api/                     transport.ts, client.ts, http.ts, errors.ts, query-client.ts, queries.ts
src/auth/                    session.ts (+ its unit test), auth-provider.tsx, token-storage.ts
src/lib/                     use-submit.ts, plan-draft.ts, forms and pickers
e2e/                         harness.ts, server.ts, shot.ts, routes.e2e.ts, journeys.e2e.ts
```

Each tab directory has its own `_layout.tsx` holding a `Stack`, so pushing a detail screen keeps the
tab bar and the back gesture. A route that is **not** a `TabTrigger` in `app/(app)/_layout.tsx` is
unreachable under the headless tabs navigator — which is why live logging sits under `today/` rather
than at a top-level `log/`.

### One navigator, two arrangements

The shell uses the headless `Tabs` from `expo-router/ui`, so the chrome is ours: the same four
triggers render as a bottom bar under 768px and a left sidebar above it. Swapping between two
different navigators on a width change would remount every screen and throw away scroll position and
half-typed input mid-resize.

Two constraints found by building it:

- **`TabList` must be a DIRECT child of `Tabs`.** The navigator discovers its routes by walking its
  own children for one. A wrapper `View` in between produces "Couldn't find any screens for the
  navigator" — so `Tabs` is itself the flex container.
- **`TabList` renders a row by default**, so the sidebar states `flexDirection: 'column'`
  explicitly. Without it the items laid out side by side and clipped at 220px. The screenshot
  caught this; a passing test did not.

## The UI vocabulary

`src/ui/index.ts` is the complete list a screen may import:

| Primitive | For |
| --- | --- |
| `Screen` | the outermost element of every route: safe area, background, padding, optional footer |
| `Stack` | every layout. There is no other container |
| `Text` | all text. Variants `title` / `heading` / `body` / `label` / `caption` / `mono` |
| `Button`, `NavButton` | actions, and actions that navigate |
| `Field`, `Input`, `NumberInput`, `DimensionInput`, `CompactField` | forms. `NumberInput` is a count; a measured quantity is a `DimensionInput` |
| `Card`, `ListRow` | the one row shape every list uses |
| `Chips` | one choice from a short flat set — list scopes, tracking mode, progression kind |
| `Empty`, `Spinner`, `ErrorNotice`, `FormError` | the four states that are not "content" |
| `Loaded` | failed / not-yet / here, around any query. A screen never writes that ternary |
| `ErrorBoundary` | the last line of defence |
| `color`, `space`, `radius`, `type`, `CONTENT_MAX_WIDTH`, `CONTROL_HEIGHT` | the only source of visual values |
| `useLayout()`, `TABLET_MIN_WIDTH` | the only layout branch: `'phone' | 'tablet'`, and where it switches |

Five composites are here rather than in a screen, because each is used from more than one place or
would otherwise be copied: `MusclePicker`, `SetLogger`, `EntryEditor`, `UnavailableEntry`,
`DayEditor`. They are still presentational — the rules they render (loads summing to 100, which
inputs a tracking mode implies, what a progression rule contains, a prescription in one line) all
live in `@cedo/contract`. An unavailable exercise has no mode, so no inputs: `SetLogger` shows it
without any, and the day editor gives it an `UnavailableEntry` — what it prescribes, and Remove.

Editing a plan follows the same split. How sets resize within an entry's total, what a target change
applies to, what a new entry prescribes, and whether another day or exercise fits are
`plan-editing.ts` in the contract, with its tests; the limits themselves are declared once beside
the schema in `workout.ts`, which enforces them. The editor only wires these to controls. It also
reads `planIssues(draft, visible)` — the schema's own verdict, located by day and exercise, and
first every entry whose exercise it cannot see, which the server would refuse — as the draft is
edited, shows it above Save, and disables Save while there is one. The editor prevents what it
models; that line catches what it does not, before the request rather than as a 422. The editor
once clamped warm-ups and working sets to 20 each while the schema allowed 20 in total, which is
the drift this split exists to stop.

**If you need something not on this list, add it here rather than inline in a screen.** The list
being complete is what stops the next session re-inventing `Loaded` under a different name.

Dark only, deliberately: this is used in a gym, usually in poor light. A light theme is a second
token map plus a `useColorScheme()` lookup, and no screen changes.

A measured quantity — a weight, reps, a duration, a distance — is a `DimensionInput`: it takes and
emits **base units**, and everything about how it is typed comes from `DIMENSION_FIELDS` in
`@cedo/contract` — the unit label (`+kg` on a bodyweight movement), whether it takes decimals, the
conversion, and the parse. Which fields a set shows, and in what order, is `fieldsOf(tracking)`.
No screen converts a unit or picks a label: the logger, the plan editor and the progression field
each used to, and disagreed. `NumberInput` is for plain counts — sets, a rep range, a percentage.

A logged set is held as an `Effort` and read and written through each field's `key`; a prescribed
set's target through its `targetKey`. A screen therefore names no measurement field itself. The
plan editor patches only the target that changed — never a whole `Effort` mapped back onto the
set — because its patch is applied to every working set, and a whole one would overwrite the other
sets' targets.

Both share one field, `TypedNumber`. A value is `number | null`, where null means empty — an empty
numeric field is not zero, and zero reps is a meaningful log. While focused the field shows the text
being typed rather than the number it parses to; the contract's parse returns both, and accepts a
comma as the decimal separator. Both are load-bearing: the first version rendered from the number,
so a half-typed "62." collapsed to 62 and the next key logged 625 kg.

What the field shows, and when its text gives way to the parent's value, is the contract's
`editField` — a pure function of the field's state and one event (`type`, `value`, `settled`,
`blur`), tested key by key in `typing.test.ts`. `TypedNumber` holds that state and forwards the
input's events to it, nothing more. The e2e journeys that type key by key stay: they prove the
wiring — that React delivers those events in the order the module assumes — because `fill` inserts
a whole string in one event and never passes through the half-typed state.

A duration is typed on a number pad, which has no `:` — so, as on a timer, the last two digits are
seconds and the two before them minutes (`CLOCK` in the contract): `130` is 1:30, `2500` is 25:00,
and a bare `90` is still 90 seconds. The field regroups its digits as they grow ("13" becomes "1:30")
and shows them as typed until it is left, so `190` reads "1:90" while focused and "2:30" after. A
duration READS as the same clock everywhere (`formatDuration`), so what you read is what you type.

## The API client

A hand-written typed `fetch` client, not Eden Treaty. See `docs/adr/0015-no-eden-treaty.md`.

Three layers, so the same route table serves more than the app. `transport.ts` sends one request and
parses its response — plain `fetch` and the contract. `client.ts` is `createApi(request)`, every route
the app calls, auth included. `http.ts` is the app's adapter: the base URL (`Platform`, env), the
signed-in credential, the 401 handler, and the app's `api`. The e2e harness is the second adapter: it
builds a client per user it signs up, from the test process, so fixtures are typed and parsed like
everything else rather than `fetch`es evaluated inside the page.

Every response is parsed with the **same contract schema** the API validated it against. On a
mismatch the client throws `ContractDriftError` with the exact JSON path. That is deliberately loud:
it lands in `console.error`, which fails the WebView run and hands the message to whoever is
iterating. Compile-time types say nothing about what a running server returns.

`useSubmit` is the one piece of shared screen mechanics: a busy flag, a message, and per-field errors
read from the contract's own `details` array. Anything that is not an `ApiError` — a drift, a dead
network — is re-thrown into the console rather than flattened into "something went wrong", because
hiding it would hide exactly what the client exists to catch.

### A weight is read in the person's unit

Every weight on screen is formatted and typed through `useWeightUnit()` — `formatEffort(…, unit)`,
`formatWeight(g, unit)`, and `DimensionInput`, which asks for the field in that unit itself. Never a
bare `formatWeight(g)`: that is kilograms, whatever the person chose in Settings. Storage is grams
either way; `fieldFor('weight', 'lb')` types pounds and stores the grams they are.

### What a write makes stale is derived, not listed

Every read declares, once, the source it is OF and the sources it EMBEDS — `READS` in
`packages/contract/src/reads.ts`. A `Workout` embeds `exercise`, because each entry carries its whole
exercise; a session embeds `workout`, because it points into its plan. A write names only the source
it changes (`useWriteTo('exercise', …)`), and `affectedBy` derives the rest: the reads OF it are
awaited — the next write may depend on them — and the reads that embed it refetch in the background.
A write that makes nothing stale — creating a media link, which is an exercise's only once the
exercise is saved with it — is a plain `useMutation`.

It used to be per write: each mutation listed what else it touched, and the lists had gaps nobody
could see. Renaming an exercise left the open plan, its progression and a live session showing the
old name for the whole `staleTime`. Query keys are flat — `[read, ...args]` — for the same reason: a
key nested under another was refreshed with it by accident, which is a dependency written nowhere.

A write the server REFUSES because what it names is gone or out of reach (404), or conflicts with
what is stored (409 — finished on another device, a session already in progress), may mean the
screen's picture is stale, because someone else's write changed it. `useWriteTo` then reads again what
the write was OF, the reads it would have awaited; when nothing has moved, it is a cheap re-read.
Not the ones that embed it, because nothing was written. A session whose plan the lifter had just
lost to a coach's edit used to keep showing it for the whole `staleTime`, inviting the same refused
set again. Membership itself is not a source any read embeds: the app writes no group, so a
membership changes only by someone else's hand, and reaches the screen this way.

A new read is a row in `READS` and a key in `keys`, whose type refuses one without the other and a
key that does not start with its read's name. The contract's T1 tests state each embedding as
behaviour; nothing ties `embeds` to the Zod shapes themselves, so a read that starts carrying another
source's data needs its row changed by hand.

### Configuration reaches the bundle only through dot access

`process.env.EXPO_PUBLIC_API_URL` — **never** `process.env['EXPO_PUBLIC_API_URL']`. Expo's Babel
plugin substitutes `EXPO_PUBLIC_*` for static member access only; bracket access is left alone and
evaluates to `undefined` in a built app, so a native build threw "EXPO_PUBLIC_API_URL must be set"
no matter what was set. Verified by grepping the bundle: with bracket access neither the value nor
the variable name appears in it.

`apps/app/types/env.d.ts` declares the variable as a real property, which is what lets dot access
coexist with `noPropertyAccessFromIndexSignature`.

It is **not** called `expo-env.d.ts`. That filename belongs to the Expo CLI, which regenerates it and
rewrites `tsconfig.json`'s `include` on every `expo start` / `expo export` — a declaration put there
is deleted the next time either runs, and the app then fails to typecheck with an index-signature
error that points nowhere near the cause.

### A rejected credential ends the session

`transport.ts` reports every `unauthenticated` answer to a request that sent a token, with the token
it sent; the session (`src/auth/session.ts`, made once in `http.ts`) signs out only if that is still
the token in use — a late 401 for a previous user's token must not sign the next one out. Every rule
about who is signed in is in that module, unit-tested (`session.test.ts`). The provider subscribes to
it, and clears the query cache whenever it says signed out — the one line of it in React, since the
cache is the root layout's.

Without it a token revoked elsewhere — signed out on another device, or simply expired after a month
— left every screen showing "Authentication required" with no way back to the login form. The guard
for it revokes the session server-side and then navigates WITHOUT a reload, because a reload would
exercise the restore-on-startup path instead, which is a different thing that already worked.

### Where the token lives

`src/auth/token-storage.ts` branches on `Platform.OS`: the OS keychain on native, `localStorage` on
web, with `expo-secure-store` imported lazily so the web bundle never evaluates it. The session takes
it as its `TokenStore`, so its tests use a fake one and never touch either.

**It branches rather than using a `.web.ts` file split, and that is not a style choice.** Metro picks
platform variants by extension, and this repo imports with explicit `.ts` extensions everywhere,
which resolves the literal file and silently skips the variant. The app called `expo-secure-store`
in a browser and every sign-in died on `getValueWithKeyAsync is not a function`. One file that
branches in the open cannot fail that way.

Documented tradeoff: a token in `localStorage` is XSS-reachable. Accepted for a self-hosted app with
no third-party scripts; moving to an httpOnly cookie touches this file and the login handler only.

### Auth status is three-state

`'loading' | 'signed-in' | 'signed-out'` — the session's `snapshot()`. On first paint the stored
token has not been read yet, and a router that treats "not known yet" as "signed out" flashes the
login screen at a returning user for one frame before bouncing them back.

## The web build is a SPA, not prerendered

`app.json` sets `web.output: "single"` — one `index.html`, no server rendering.

**One bundle, deliberately.** Expo SDK 58 turns on async routes for web — a chunk per screen,
fetched on first navigation — and `app.json` turns them off (`asyncRoutes: { web: false }` on the
`expo-router` plugin). Each deploy replaces every chunk, so a tab left open across one broke on its
next first visit to any screen; expo-router caches the failed lazy import, so the error boundary's
"Try again" could never recover, and only a manual reload did. For an app behind a login on a home
server, splitting buys little load time and costs that. With one bundle, navigation never fetches
code.

Build output (`/_expo/static/*`, `/assets/*`) is content-hashed: served as files with a year-long
immutable header — only on a 2xx or 304 — and a missing file is a **404**, never the SPA fallback.
The Caddyfile and `e2e/server.ts` do the same, and `e2e/harness.e2e.ts` pins it.

`"static"` prerenders one HTML file per route, which cannot work for a route whose parameter is only
known at request time. Opening `/exercises/<id>` directly — a shared link, or just reloading a detail
screen — served markup rendered without that id, the client hydrated with it, and React threw
`#418: Hydration failed`. Every dynamic route was affected, and the route sweep never caught it
because it only visits routes without ids.

Nothing here wants server rendering: the whole app is behind authentication and is served from
someone's NAS, so there is no SEO and no first-paint budget to defend. Caddy's fallback is
correspondingly simple — `try_files {path} /index.html`.

## Development runs the same shape as production

`bun run dev` starts the API on :3000 and Metro on :8081. The app calls the relative path `/api` in
both, because `apps/app/metro.config.js` proxies `/api/*` to the API — the development counterpart
of the Caddyfile.

That indirection is the point. Pointing the app at `http://localhost:3000` instead would make every
development request cross-origin, which would need CORS on the API, which the whole three-container
shape exists to avoid. Without the proxy the app came up looking fine and every request 404'd
against Metro. See `docs/09-deployment.md`.

`CEDO_DEV_API_ORIGIN` overrides the target if the API is not on :3000.

## Seeing what you built

```bash
bun run shot /exercises            # render, screenshot to .artifacts/, print console errors
bun run shot /workouts --tablet
bun run e2e                        # static routes at phone width, the tablet shell, the journeys;
                                   # fails on any console error, including any failed read
```

`bun run shot` is the inner loop: edit a screen, run it, **read the PNG**, read the errors. Both the
sidebar bug and the platform-resolution bug above were found by looking at the picture, not by an
assertion.

The harness reveals a target before touching it (`scrollIntoView`, then click) and can wait for a
selector whose id is not known ahead of time. Both exist because their absence produced failures
about viewport geometry and query timing rather than about the app.

Adding a screen: give every element a `testID`, add it to the sweep in `e2e/routes.e2e.ts` and, for
a journey, to its driver in `e2e/screens/`, and run `bun run e2e`. The harness fails on any console error without a single hand-written assertion, so
the sweep is coverage rather than a set of expectations. See `docs/10-testing.md`.

## One rule is calibrated differently here

`max-lines-per-function` is 50 across the repo and **120 for `.tsx` files in the app**.

The rule is a proxy for complexity, and it is a good one for imperative code. A declarative render
function is a different shape: a form with six fields is a hundred lines of markup with one branch
in it, and splitting it into `<TopHalf>` and `<BottomHalf>` makes it harder to read, not easier.

Every genuinely separable piece has been extracted — `Loaded`, `FormError`, `MuscleOptions`,
`TokenList`, `History`, `EntryEditor`. What remains long is markup. If a screen approaches 120 lines
it is usually because it grew a rule, and the rule belongs in `@cedo/contract`.
