import { describe, expect, test } from 'bun:test'
import { EntryCue, MAX_CUE_LENGTH, restLeft } from './rest.ts'

/** What the logger counts down after a working set: the entry's rest, from when it was logged. */
describe('rest left', () => {
  const at = (iso: string) => Date.parse(iso)
  const log = (loggedAt: string, isWarmup = false) => ({ entryId: 'e', loggedAt, isWarmup })

  test('is the rest, less the time since the latest working set', () => {
    const logs = [log('2026-10-21T10:00:00Z'), log('2026-10-21T10:02:30Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 120 }, at('2026-10-21T10:03:00Z'))).toBe(90)
  })

  test('counts in whole seconds, rounding up: 0 only once it is over', () => {
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 60 }, at('2026-10-21T10:00:59.400Z'))).toBe(1)
    expect(restLeft(logs, { id: 'e', restSeconds: 60 }, at('2026-10-21T10:01:00Z'))).toBe(0)
    expect(restLeft(logs, { id: 'e', restSeconds: 60 }, at('2026-10-21T10:05:00Z'))).toBe(0)
  })

  /** A warm-up is the ramp to the work, not a set the rest is for. */
  test('starts from a working set — never a warm-up, nor another entry’s set', () => {
    const logs = [
      log('2026-10-21T10:00:00Z'),
      log('2026-10-21T10:01:00Z', true),
      { entryId: 'other', loggedAt: '2026-10-21T10:01:30Z', isWarmup: false },
    ]
    expect(restLeft(logs, { id: 'e', restSeconds: 120 }, at('2026-10-21T10:01:40Z'))).toBe(20)
  })

  /**
   * The set's time is the server's, the clock reading it the device's, and the two disagree: a
   * set can look logged a moment in the future. The rest is never longer than prescribed.
   */
  test('is never more than the rest, however far ahead the server’s clock is', () => {
    const logs = [log('2026-10-21T10:00:01.500Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 5 }, at('2026-10-21T10:00:00Z'))).toBe(5)
  })

  test('is nothing before the first working set, or without a rest prescribed', () => {
    expect(restLeft([], { id: 'e', restSeconds: 120 }, at('2026-10-21T10:00:00Z'))).toBeNull()
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: null }, at('2026-10-21T10:00:10Z'))).toBeNull()
  })
})

/** What the coach or the AI tells the athlete about one entry: "pause 1 s at the chest". */
describe('an entry’s cue', () => {
  test('is trimmed, and blank is none', () => {
    expect(EntryCue.parse('  Pause at the chest ')).toBe('Pause at the chest')
    expect(EntryCue.parse('   ')).toBeNull()
    expect(EntryCue.parse(null)).toBeNull()
  })

  test(`holds at most ${MAX_CUE_LENGTH} characters`, () => {
    expect(EntryCue.safeParse('x'.repeat(MAX_CUE_LENGTH)).success).toBe(true)
    expect(EntryCue.safeParse('x'.repeat(MAX_CUE_LENGTH + 1)).success).toBe(false)
  })
})
