import { expect, test } from 'bun:test'

/**
 * A journey reaches the app only through its screen drivers (`screens/`), so a test id lives in
 * exactly one place: a renamed id breaks one driver line, not every journey passing through the
 * screen. A journey may still navigate (`goto`), wait (`until`), type into what has focus (`keys`,
 * `press`, `type`) and set up data (`client`) — none of those names a screen. See
 * docs/10-testing.md.
 */

const REACHES_PAST_A_SCREEN =
  /\bpage\.(?:click|fill|text|exists|waitFor|waitForSelector|evaluate|value)\(|data-testid/u

test('no journey names a test id or touches an element itself', async () => {
  const source = await Bun.file(new URL('journeys.e2e.ts', import.meta.url)).text()
  const offending = source
    .split('\n')
    .flatMap((line, i) => (REACHES_PAST_A_SCREEN.test(line) ? [`${i + 1}: ${line.trim()}`] : []))
  expect(offending).toEqual([])
})
