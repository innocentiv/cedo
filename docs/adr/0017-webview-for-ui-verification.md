# 0017 — `Bun.WebView` for UI verification; no component tests

**Status:** Accepted (2026-08-23)

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

Verified on 2026-08-23 with zero dependencies installed, in 850ms:

```
CAPTURED: [
 ["warn",  "a warning"],
 ["error", "[rejection] Error: async boom"],
 ["error", "[network] TypeError: Load failed"],
 ["error", "[pageerror] ReferenceError: Can't find variable: undefinedFunction"]
]
PNG BYTES: 15077
```

A single `console:` handler on the constructor captures console output, unhandled promise
rejections, failed network calls, and uncaught exceptions from real simulated clicks. Screenshots
come back as a `Blob`. The screenshot was read back and visually confirmed.

This means the harness can fail a run on _any_ console error without a single hand-written
assertion, and hand the AI both the message and a picture.

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
