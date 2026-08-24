# Frontend

Expo SDK 57 / React Native 0.86 / React 19.2, with `expo-router`. Web-mobile-first, plus a tablet
two-pane layout. It depends on **`@cedo/contract` and nothing else** from this repo.

## The thinness rule

This is the rule the whole frontend is organised around, and the reason the test suite can be as
small as it is.

> A screen **may**: call `api.*`, render UI primitives, hold form state, and call pure helpers from
> `@cedo/contract` (`formatWeight`, `nextTarget`, `thumbnailUrl`).
>
> A screen **may not**: perform unit arithmetic, sum muscle loads, decide progressions, hand-format
> measurements, or branch on domain rules. If a screen needs a rule, the rule belongs in the
> contract, where it is unit-tested with no DOM.
>
> No raw `<View>`, `<Text>` or `StyleSheet` in a screen file. No literal colour or pixel value
> anywhere outside `src/ui/tokens.ts`.

Every behaviour is proven on the backend (`docs/10-testing.md`). If a screen grows logic worth
testing, that is the signal it belongs somewhere else.

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
app/(app)/{today,workouts,exercises,settings}.tsx
src/ui/                      the entire visual vocabulary
src/api/                     http.ts, errors.ts, client.ts, query-client.ts
src/auth/                    auth-provider.tsx, token-storage.ts
src/lib/                     use-submit.ts
e2e/                         harness.ts, server.ts, shot.ts, routes.e2e.ts
```

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
| `Field`, `Input`, `NumberInput` | forms |
| `Card`, `ListRow` | the one row shape every list uses |
| `Empty`, `Spinner`, `ErrorNotice`, `FormError` | the four states that are not "content" |
| `ErrorBoundary` | the last line of defence |
| `color`, `space`, `radius`, `type` | the only source of visual values |
| `useLayout()` | the only layout branch: `'phone' | 'tablet'` |

Dark only, deliberately: this is used in a gym, usually in poor light. A light theme is a second
token map plus a `useColorScheme()` lookup, and no screen changes.

`NumberInput` holds `number | null`, where null means empty — an empty numeric field is not zero,
and zero reps is a meaningful log.

## The API client

A hand-written typed `fetch` client, not Eden Treaty. See `docs/adr/0015-no-eden-treaty.md`.

Every response is parsed with the **same contract schema** the API validated it against. On a
mismatch the client throws `ContractDriftError` with the exact JSON path. That is deliberately loud:
it lands in `console.error`, which fails the WebView run and hands the message to whoever is
iterating. Compile-time types say nothing about what a running server returns.

`useSubmit` is the one piece of shared screen mechanics: a busy flag, a message, and per-field errors
read from the contract's own `details` array. Anything that is not an `ApiError` — a drift, a dead
network — is re-thrown into the console rather than flattened into "something went wrong", because
hiding it would hide exactly what the client exists to catch.

### Configuration reaches the bundle only through dot access

`process.env.EXPO_PUBLIC_API_URL` — **never** `process.env['EXPO_PUBLIC_API_URL']`. Expo's Babel
plugin substitutes `EXPO_PUBLIC_*` for static member access only; bracket access is left alone and
evaluates to `undefined` in a built app, so a native build threw "EXPO_PUBLIC_API_URL must be set"
no matter what was set. Verified by grepping the bundle: with bracket access neither the value nor
the variable name appears in it.

`apps/app/expo-env.d.ts` declares the variable as a real property, which is what lets dot access
coexist with `noPropertyAccessFromIndexSignature`.

### A rejected credential ends the session

`http.ts` calls a handler whenever the API answers `unauthenticated` **and** a token was actually
sent. `AuthProvider` registers one that clears the session and returns to login.

Without it a token revoked elsewhere — signed out on another device, or simply expired after a month
— left every screen showing "Authentication required" with no way back to the login form. The guard
for it revokes the session server-side and then navigates WITHOUT a reload, because a reload would
exercise the restore-on-startup path instead, which is a different thing that already worked.

### Where the token lives

`src/auth/token-storage.ts` branches on `Platform.OS`: the OS keychain on native, `localStorage` on
web, with `expo-secure-store` imported lazily so the web bundle never evaluates it.

**It branches rather than using a `.web.ts` file split, and that is not a style choice.** Metro picks
platform variants by extension, and this repo imports with explicit `.ts` extensions everywhere,
which resolves the literal file and silently skips the variant. The app called `expo-secure-store`
in a browser and every sign-in died on `getValueWithKeyAsync is not a function`. One file that
branches in the open cannot fail that way.

Documented tradeoff: a token in `localStorage` is XSS-reachable. Accepted for a self-hosted app with
no third-party scripts; moving to an httpOnly cookie touches this file and the login handler only.

### Auth status is three-state

`'loading' | 'signed-in' | 'signed-out'`. On first paint the stored token has not been read yet, and
a router that treats "not known yet" as "signed out" flashes the login screen at a returning user
for one frame before bouncing them back.

## Seeing what you built

```bash
bun run shot /exercises            # render, screenshot to .artifacts/, print console errors
bun run shot /workouts --tablet
bun run e2e                        # every route, both widths, fails on any console error
```

`bun run shot` is the inner loop: edit a screen, run it, **read the PNG**, read the errors. Both the
sidebar bug and the platform-resolution bug above were found by looking at the picture, not by an
assertion.

The harness reveals a target before touching it (`scrollIntoView`, then click) and can wait for a
selector whose id is not known ahead of time. Both exist because their absence produced failures
about viewport geometry and query timing rather than about the app.

Adding a screen: give every element a `testID`, add it to the sweep in `e2e/routes.e2e.ts`, and run
`bun run e2e`. The harness fails on any console error without a single hand-written assertion, so
the sweep is coverage rather than a set of expectations. See `docs/10-testing.md`.

## One rule is calibrated differently here

`max-lines-per-function` is 50 across the repo and **120 for `.tsx` files in the app**.

The rule is a proxy for complexity, and it is a good one for imperative code. A declarative render
function is a different shape: a form with six fields is a hundred lines of markup with one branch
in it, and splitting it into `<TopHalf>` and `<BottomHalf>` makes it harder to read, not easier.

Every genuinely separable piece has been extracted — `Loaded`, `FormError`, `MuscleOptions`,
`TokenList`, `History`, `EntryEditor`. What remains long is markup. If a screen approaches 120 lines
it is usually because it grew a rule, and the rule belongs in `@cedo/contract`.
