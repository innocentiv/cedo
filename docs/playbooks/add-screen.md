# Adding a screen

The screen is the last step, not the first. If it needs a rule, the rule goes in the contract and is
tested there — see `docs/08-frontend.md` for the thinness rule this exists to keep.

## 1. Make sure the data is already reachable

A screen calls hooks from `src/api/queries.ts`, never `api.*` and never `fetch`. If the hook does not
exist yet, add it there and add its key to `keys` in `src/api/query-client.ts`. A new read is also a
row in the contract's `READS`, naming what it is built from; a write names only the one source it
changes (`useWriteTo('exercise', …)`), and what that makes stale is derived. See
`docs/08-frontend.md`.

## 2. Put the file where the router expects it

```
app/(app)/<tab>/index.tsx        the tab's own screen
app/(app)/<tab>/[id]/index.tsx   a detail screen
app/(app)/<tab>/[id]/edit.tsx    an editor
```

Each tab already has a `_layout.tsx` holding a `Stack`, so pushing a detail screen keeps the tab bar
and the back gesture. A new **tab** also needs a `TabTrigger` in `app/(app)/_layout.tsx`; anything
that is not a trigger is unreachable under the headless tabs navigator.

Route filenames are kebab-case like every other file, so a dynamic segment is `[id]`, not
`[sessionId]`.

## 3. Write it out of the vocabulary

Import from `src/ui/index.ts` and `@cedo/contract`, and from nothing else that renders. `Screen` is
the outermost element; `Stack` is the only container; `Loaded` handles failed / not-yet / here, so a
screen never writes that ternary itself.

**Give every element a `testID`.** It is what the harness can see, and `testID` compiles to
`data-testid` under `react-native-web`.

## 4. Look at it

```bash
bun run shot /your/route            # rebuilds the web bundle first, so it shows your change
bun run shot /your/route --tablet
```

Then **read the PNG**. Four real bugs in M8 and M9 were green in every assertion and obvious in the
picture: a numeric field that appended instead of replacing, a sidebar laid out as a row, a form
stretched across 1280px, and unselectable text on the one value a user must copy.

## 5. Add it to the sweep

A route with no id goes in `ROUTES` in `apps/app/e2e/routes.e2e.ts`. Anything needing real data gets
a journey in `journeys.e2e.ts`.

```bash
bun run e2e     # foreground only — a backgrounded run reports false failures
```

Assertions are the small part. `withApp` fails on **any** console error and always writes a
screenshot, so a broken render, a failed request, an unhandled rejection or a `ContractDriftError`
fails the run without anyone predicting it.

## 6. The gate

```bash
bun run check
```
