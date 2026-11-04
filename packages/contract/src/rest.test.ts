import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_REST_S,
  chimesAtEnd,
  restCounted,
  restLeft,
  restNote,
  restPhase,
  restPlace,
  restRemaining,
  restTitle,
  restWords,
} from './rest.ts'

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

  /** A rest of none is "straight on" — a superset's first exercise — not a rest that is over. */
  test('is nothing for a rest of 0: straight on, not over', () => {
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 0 }, at('2026-10-21T10:00:01Z'))).toBeNull()
  })

  test('falls back to the working set before, once the latest is undone', () => {
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: 120 }, at('2026-10-21T10:01:00Z'))).toBe(60)
  })

  test('is two minutes, by default', () => {
    expect(DEFAULT_REST_S).toBe(120)
  })

  test('is nothing before the first working set, or without a rest prescribed', () => {
    expect(restLeft([], { id: 'e', restSeconds: 120 }, at('2026-10-21T10:00:00Z'))).toBeNull()
    const logs = [log('2026-10-21T10:00:00Z')]
    expect(restLeft(logs, { id: 'e', restSeconds: null }, at('2026-10-21T10:00:10Z'))).toBeNull()
  })
})

describe('a rest running, extended', () => {
  const rest = { since: '2026-10-25T18:00:00Z', seconds: 90 }
  const at = (s: number) => Date.parse('2026-10-25T18:00:00Z') + s * 1000

  test('counts down from when the set was logged, and +30 s adds thirty each time', () => {
    expect(restRemaining(rest, 0, at(30))).toBe(60)
    expect(restRemaining(rest, 1, at(30))).toBe(90)
    expect(restRemaining(rest, 2, at(100))).toBe(50)
  })

  test('never below zero, nor more than the rest against a server clock ahead', () => {
    expect(restRemaining(rest, 0, at(500))).toBe(0)
    expect(restRemaining(rest, 0, at(-20))).toBe(90)
  })
})

/** The countdown and what the server keeps (#38): the longer, never the two added. */
describe('the rest counted', () => {
  const since = '2026-10-26T18:00:00.000Z'
  const counted = { since, seconds: 90 }
  const kept = (seconds: number, at = since) => ({
    since: at,
    endsAt: new Date(Date.parse(at) + seconds * 1000).toISOString(),
  })

  test('a tap here, already kept there, is counted once', () => {
    expect(restCounted(counted, 1, kept(120))?.seconds).toBe(120)
  })

  test('a tap on another device, or before a reload, is the server’s to know', () => {
    expect(restCounted(counted, 0, kept(150))?.seconds).toBe(150)
  })

  test('a tap here not yet kept there counts, and a rest the server does not keep is the sets’', () => {
    expect(restCounted(counted, 2, kept(90))?.seconds).toBe(150)
    expect(restCounted(counted, 0, null)?.seconds).toBe(90)
  })

  test('skipped — ending when it began — it is not counted, here or on another device', () => {
    expect(restCounted(counted, 1, kept(0))).toBeNull()
  })

  test('what the server keeps of an earlier rest is not this one', () => {
    expect(restCounted(counted, 0, kept(300, '2026-10-26T17:55:00.000Z'))?.seconds).toBe(90)
  })
})

/**
 * Where the rest after the latest set stands (#63): what the workout shows in Log's place. While it
 * runs, or when none follows the set, the set just logged can still be undone there.
 */
describe('the rest’s phase', () => {
  const since = '2026-10-26T18:00:00.000Z'
  const rest = { since, seconds: 90 }
  const at = (seconds: number) => Date.parse(since) + seconds * 1000

  test('none follows a set the sets give no rest after: a warm-up, a superset’s first, a 0', () => {
    expect(restPhase(null, 0, null, false, at(10))).toEqual({ phase: 'none' })
  })

  test('runs, with what is left of it — +30 s counted', () => {
    expect(restPhase(rest, 0, null, false, at(30))).toEqual({ phase: 'running', left: 60 })
    expect(restPhase(rest, 1, null, false, at(100))).toEqual({ phase: 'running', left: 20 })
  })

  test('is over once it has run out', () => {
    expect(restPhase(rest, 0, null, false, at(90))).toEqual({ phase: 'over', skipped: false })
  })

  test('is over once skipped — here, or on another device', () => {
    expect(restPhase(rest, 0, null, true, at(10))).toEqual({ phase: 'over', skipped: true })
    const skippedThere = { since, endsAt: since }
    expect(restPhase(rest, 0, skippedThere, false, at(10))).toEqual({
      phase: 'over',
      skipped: true,
    })
  })
})

/**
 * The chime at a rest's end (#24, #63): for the rest seen running that ran out — the same one, by
 * the sets it follows.
 */
describe('the chime at a rest’s end', () => {
  const over = { phase: 'over', skipped: false } as const

  test('sounds for the rest seen running, run out', () => {
    expect(chimesAtEnd(3, 3, over)).toBe(true)
  })

  test('is silent for a rest skipped, still running, or opened already over', () => {
    expect(chimesAtEnd(3, 3, { phase: 'over', skipped: true })).toBe(false)
    expect(chimesAtEnd(3, 3, { phase: 'running', left: 10 })).toBe(false)
    expect(chimesAtEnd(null, 3, over)).toBe(false)
  })

  test('is silent for another rest than the one seen: an undo took the session back to it', () => {
    expect(chimesAtEnd(3, 2, over)).toBe(false)
    expect(chimesAtEnd(3, null, { phase: 'none' })).toBe(false)
  })
})

/**
 * Where an entry sits for its rest, and how the plan says it (#48): the logger rests a superset
 * after the round — its last entry's rest — and an earlier entry's only when it ends the round.
 * `restingAfter` keeps it; `session-flow.test.ts` walks a day to hold the two to each other.
 */
describe('where an entry sits for its rest', () => {
  const day = [
    { supersetGroup: null },
    { supersetGroup: 'A' },
    { supersetGroup: 'B' },
    { supersetGroup: 'A' },
    { supersetGroup: 'B' },
    { supersetGroup: 'C' },
  ]

  test('its own, out of a superset', () => {
    expect(restPlace(day, 0)).toBe('own')
  })

  test('last, on a superset’s last entry in the day’s order', () => {
    expect(restPlace(day, 3)).toBe('last')
    expect(restPlace(day, 4)).toBe('last')
  })

  test('earlier, on the entries before it — however the letters interleave', () => {
    expect(restPlace(day, 1)).toBe('earlier')
    expect(restPlace(day, 2)).toBe('earlier')
  })

  test('its own, on a letter no other entry shares: there is no round', () => {
    expect(restPlace(day, 5)).toBe('own')
  })
})

describe('an entry’s rest, said', () => {
  test('as its time, said where it falls', () => {
    expect(restWords(90, 'own')).toBe('rest 1:30')
    expect(restWords(90, 'last')).toBe('rest 1:30 after the round')
    expect(restWords(90, 'earlier')).toBe('rest 1:30 when it ends the round')
  })

  test('straight on for none — 0 or null alike, wherever it falls', () => {
    for (const place of ['own', 'last', 'earlier'] as const) {
      expect(restWords(0, place)).toBe('straight on')
      expect(restWords(null, place)).toBe('straight on')
    }
  })

  test('opening a line of its own, as the app shows it', () => {
    expect(restTitle(90, 'last')).toBe('Rest 1:30 after the round')
    expect(restTitle(null, 'own')).toBe('Straight on')
  })

  test('with when it counts beside an earlier entry’s rest, and only there', () => {
    expect(restNote(90, 'earlier')).toContain('only when this entry ends the round')
    expect(restNote(0, 'earlier')).toBeNull()
    expect(restNote(null, 'earlier')).toBeNull()
    expect(restNote(90, 'last')).toBeNull()
    expect(restNote(90, 'own')).toBeNull()
  })
})
