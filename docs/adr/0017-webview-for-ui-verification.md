# 0017 — `Bun.WebView` for UI verification; no component tests

**Status:** Accepted (2026-08-23), corrected (2026-08-24)

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
  nothing about runtime errors — the worst kind of green. `apps/app/e2e/harness.ts` has a test that
  a page throwing during load actually fails the run.
