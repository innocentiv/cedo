import { expect, test } from 'bun:test'
import type { Caller } from '../../plugins/auth.ts'
import type { Training } from './training.ts'

/**
 * Whose training a read is of is told only by `own` and `ownOrCoached` (#11): a `Training` written
 * by hand — an athlete's id the caller was never checked against — does not compile. `tsc` is the
 * test; the directive below fails it the day a hand-written one would pass.
 */
const forged = (reader: Caller, athleteId: string): Training =>
  // @ts-expect-error — not resolved: no `own` or `ownOrCoached` said whose it is.
  ({ reader, athleteId })

test('a Training cannot be written by hand, only resolved', () => {
  expect(typeof forged).toBe('function')
})
