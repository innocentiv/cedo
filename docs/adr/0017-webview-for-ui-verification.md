# 0017 — `Bun.WebView` for UI verification; no component tests

**Status:** Accepted (2026-08-23), corrected (2026-08-24), amended (2026-10-21: the app's plain
modules may be unit-tested — see the end)

## Context

An AI is the primary author of this codebase. For it to iterate on the frontend it must be able to
(a) see what a screen actually renders and (b) learn about runtime errors it caused. Reading source
code is not sufficient feedback.

Separately, the project mandates that **all behaviour is tested on the backend** and that UI code
stays trivially thin. So the frontend test tier is not responsible for proving behaviour.

## Decision

Use `Bun.WebView` — headless browser automation built into Bun 1.4 — for all UI verification. No
component tests, no happy-dom, no Testing Library, no Playwright.

Frontend tests answer exactly three questions: _does every route render, does anything explode, and
what does it look like._

## Why

Re-measured on 2026-08-24 against Bun 1.4.0, because the first note in this file overstated what the
runtime does on its own. The actual API surface is `navigate`, `evaluate`, `click`, `type`, `press`,
`scroll`, `screenshot`, `resize`, `title`, `url`, `reload` — there is no `loadHTML`, so a page must
be served over HTTP, which is what the harness does anyway.

What the `console:` constructor option captures, exactly:

| Event | Reaches the handler? |
| --- | --- |
| `console.log` / `warn` / `error` | **yes** |
| Uncaught exception | only if the page forwards it |
| Unhandled promise rejection | only if the page forwards it |
| Failed `fetch` | only if the page forwards it |

So the "fail on any console error" harness needs a **six-line capture shim** installed before the
app bundle runs:

```js
addEventListener('error', (e) => console.error('[pageerror]', e.message))
addEventListener('unhandledrejection', (e) => console.error('[rejection]', String(e.reason)))
```

The shim is injected by the harness into the served `index.html`, **not** shipped in the app bundle.
There is no `addInitScript`-style hook, and injecting with `evaluate` after navigation would miss
every error thrown during initial render — which is precisely the class of error worth catching.
Keeping it in the harness also honours the thinness rule: no test scaffolding in production code.

Confirmed working end to end on this machine: console capture through the shim, `screenshot()`
returning a `Blob` that `Bun.write` accepts, `click`/`type` driving a real form submit, `localStorage`
persisting (so web token storage works), `resize` switching to tablet width, and `data-testid`
queryable via `evaluate` — which is what `testID` compiles to under `react-native-web`.

This means the harness can fail a run on _any_ console error without a hand-written assertion, and
hand the AI both the message and a picture.

## Rejected

- **Component tests (happy-dom + Testing Library, `react-native` aliased to `react-native-web`).**
  Technically viable — tsconfig path aliasing was verified working under `bun test`. Rejected
  because it costs three devDependencies to test a fake DOM approximation of the thing a real WebKit
  render already covers, and because the interesting logic lives in `packages/contract`, where plain
  unit tests cover it with no DOM at all.
- **Playwright.** The established choice, but a large devDependency plus a browser download, to do
  what the runtime now does natively.

## Consequences

- `bun run shot <route>` is the frontend inner loop: render, screenshot to `.artifacts/`, print
  captured console output.
- **Engine split:** WebView uses system WebKit on macOS and Chrome via CDP on Linux. Same tests, two
  engines. If a divergence causes a "passes locally, fails in CI" surprise, pin both to
  `backend: 'chrome'`.
- `Bun.WebView` is new in Bun 1.4. If it regresses, the fallback is Playwright with the same harness
  shape.
- **The capture shim is load-bearing.** Delete it and every e2e test still passes while proving
  nothing about runtime errors — the worst kind of green. `apps/app/e2e/harness.e2e.ts` has a test
  that an uncaught exception in the page fails the run; it was watched failing with the shim
  removed. (The shim lives in `apps/app/e2e/server.ts`. This bullet used to promise that test before
  it existed.)
- **A failed read must reach the console too.** A screen renders a failed query as an inline
  notice and TanStack Query logs nothing, so the route sweep passed over screens whose every request
  failed. The app's `QueryCache.onError` sends every failed read except a 401 to `console.error`,
  and `harness.e2e.ts` pins that a 404 read fails the run.

## Amended (2026-10-21): the app's plain modules may be unit-tested

Behaviour the app owns and no backend can — who is signed in on this device: the stored token,
restoring it at startup, a late 401 for the previous person's token, a keychain that throws — had no
tier at all. It lived in React effects, so a unit test needed a fake DOM, which this record rejects;
and it is not reproducible in the WebView harness without test hooks in production code. Two of its
rules were fixed with no test (c97961b).

So it moved into a plain module, `apps/app/src/auth/session.ts`, which imports neither React nor
React Native, and is unit-tested beside it with `bun test`, a fake keychain and a fake API. **That is
the line:** a module of the app that imports neither may be unit-tested; a component may not. The
rejection of component tests above stands, and so does the rule that domain behaviour belongs in the
contract or a service — this tier is for the app's own state, not a second home for domain rules.
