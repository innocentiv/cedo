import { describe, expect, test } from 'bun:test'
import {
  byWeek,
  counted,
  formatDay,
  formatMinutes,
  personalBestsLabel,
  personalBestsShort,
  sessionLine,
  openedSessionName,
  sessionName,
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
    const strip = weekStrip(
      at(19, 0),
      [iso(18), iso(19, 7), iso(21), iso(21, 19), iso(25, 22), iso(26)],
      at(23),
    )
    expect(strip.map((d) => d.trained)).toEqual([true, false, true, false, false, false, true])
    expect(strip.map((d) => d.initial).join('')).toBe('MTWTFSS')
  })

  test('rings today — and no day of a week that is not this one', () => {
    expect(weekStrip(at(19, 0), [], at(23)).findIndex((d) => d.today)).toBe(4)
    expect(weekStrip(at(12, 0), [], at(23)).some((d) => d.today)).toBe(false)
  })

  test('counts a thing as said aloud', () => {
    expect([counted(1, 'set'), counted(3, 'set'), counted(0, 'session')]).toEqual([
      '1 set',
      '3 sets',
      '0 sessions',
    ])
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

describe('a session by name', () => {
  const named = (workoutId: string | null, workoutName: string | null, dayName: string | null) =>
    sessionName({ workoutId, workoutName, dayName })

  test('by its day, else its workout, else as logged without a plan', () => {
    expect(named('w', 'Upper Lower', 'Lower A')).toBe('Lower A')
    expect(named('w', 'Upper Lower', null)).toBe('Upper Lower')
    expect(named(null, null, null)).toBe('Without a plan')
  })

  /** Read by a coach (#30), the athlete's own plan is out of sight — but it was followed. */
  test('a plan out of the reader’s sight is unavailable, never none', () => {
    expect(named('w', null, null)).toBe('Plan unavailable')
  })

  /** Opened, it says the name its row did: by the day its plan reaches, else as the row would. */
  test('opened, by the day its plan reaches — unavailable, or none, as in its row', () => {
    const day = { reachable: true as const, day: { name: 'Lower A' } }
    expect(openedSessionName({ workoutId: 'w', plan: day })).toBe('Lower A')
    expect(openedSessionName({ workoutId: 'w', plan: { reachable: false } })).toBe(
      'Plan unavailable',
    )
    expect(openedSessionName({ workoutId: null, plan: null })).toBe('Without a plan')
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
    expect([0, 1, 3].map((n) => personalBestsShort(n))).toEqual([null, 'PB', '3 PBs'])
  })
})
