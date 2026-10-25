import { describe, expect, test } from 'bun:test'
import {
  byWeek,
  formatDay,
  formatMinutes,
  personalBestsLabel,
  sessionLine,
  startOfWeek,
  weekStrip,
} from './week.ts'

/** Local time throughout: a week is the reader's, and so is every date here. */
const at = (day: number, hour = 12): Date => new Date(2026, 9, day, hour)
const iso = (day: number, hour = 12): string => at(day, hour).toISOString()

describe('a week (#25)', () => {
  test('starts at midnight on its Monday, from any day of it', () => {
    // Monday 19 October 2026 to Sunday 25 October.
    expect(startOfWeek(at(19, 0))).toEqual(at(19, 0))
    expect(startOfWeek(at(22, 18))).toEqual(at(19, 0))
    expect(startOfWeek(at(25, 23))).toEqual(at(19, 0))
    expect(startOfWeek(at(26, 0))).toEqual(at(26, 0))
  })

  test('marks the days trained on, Monday first, and nothing outside it', () => {
    expect(
      weekStrip(at(19, 0), [iso(18), iso(19, 7), iso(21), iso(21, 19), iso(25, 22), iso(26)]),
    ).toEqual([true, false, true, false, false, false, true])
  })
})

describe('history by week (#25)', () => {
  test('keeps the order given and says each week as it is said aloud', () => {
    const now = at(23)
    const weeks = byWeek(
      [
        { startedAt: iso(22) },
        { startedAt: iso(19) },
        { startedAt: iso(16) },
        { startedAt: iso(6) },
      ],
      now,
    )
    expect(weeks.map((w) => [w.label, w.items.length])).toEqual([
      ['This week', 2],
      ['Last week', 1],
      ['Week of 5 Oct', 1],
    ])
  })
})

describe('a session in one line (#25)', () => {
  test('says its day, how long it took and its working sets', () => {
    expect(formatDay(at(23))).toBe('Fri 23 Oct')
    expect(sessionLine({ startedAt: iso(23, 10), endedAt: iso(23, 10), setCount: 1 })).toBe(
      'Fri 23 Oct · 0 min · 1 set',
    )
    const started = at(23, 10)
    const ended = new Date(started.getTime() + 52 * 60_000)
    expect(
      sessionLine({ startedAt: started.toISOString(), endedAt: ended.toISOString(), setCount: 18 }),
    ).toBe('Fri 23 Oct · 52 min · 18 sets')
  })

  test('says no time for a session still in progress', () => {
    expect(sessionLine({ startedAt: iso(23), endedAt: null, setCount: 4 })).toBe(
      'Fri 23 Oct · 4 sets',
    )
  })

  test('reads an hour and over as hours and minutes', () => {
    expect([59 * 60, 3600, 3900, 5400].map((s) => formatMinutes(s))).toEqual([
      '59 min',
      '1 h',
      '1 h 5 min',
      '1 h 30 min',
    ])
  })

  test('counts its personal bests in words, and says nothing of none', () => {
    expect([0, 1, 3].map((n) => personalBestsLabel(n))).toEqual([
      null,
      'A personal best',
      '3 personal bests',
    ])
  })
})
