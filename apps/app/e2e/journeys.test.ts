import { expect, test } from 'bun:test'

/**
 * A journey reaches the app only through its screen drivers (`screens/`), so a test id lives in
 * exactly one place: a renamed id breaks one driver line, not every journey passing through the
 * screen. A journey may still navigate (`goto`), wait (`until`), type into what has focus (`keys`,
 * `press`) and set up data (`client`) — none of those names a screen. See docs/10-testing.md.
 */

const REACHES_PAST_A_SCREEN: readonly RegExp[] = [
  // A page method that touches an element — however it is spelled, and across lines.
  /\bpage\s*\??\.\s*(?:click|fill|text|exists|waitFor|waitForSelector|evaluate|value)\b/gu,
  /\bpage\s*\??\.?\s*\[/gu,
  // The page renamed or taken apart, which would hide the calls above.
  /\b(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*page\b/gu,
  /withApp\([^,]+,\s*async\s*\(\s*\{/gu,
  // A test id, however it is reached.
  /data-testid|testID|dataset\.testid/gu,
]

test('no journey names a test id or touches an element itself', async () => {
  const source = await Bun.file(new URL('journeys.e2e.ts', import.meta.url)).text()
  const lineOf = (index: number) => source.slice(0, index).split('\n').length
  const offending = REACHES_PAST_A_SCREEN.flatMap((pattern) =>
    [...source.matchAll(pattern)].map(
      (m) => `${lineOf(m.index)}: ${m[0].replaceAll(/\s+/gu, ' ')}`,
    ),
  )
  expect(offending).toEqual([])
})
