import { describe, expect, test } from 'bun:test'
import { adherenceOf } from './adherence.ts'

/**
 * How regularly someone trains, as the review says it: sessions a week, the streak they are on,
 * and the longest gap between two sessions — at a time handed in, so a day is a day here and not
 * whenever the test runs. Days are calendar days, and the streak forgives one day of rest. That the
 * review reads it from the sessions logged is `route.test.ts`'s.
 */

/** The time the review is read: the evening of Friday 30 October. */
const NOW = Date.parse('2026-10-30T20:00:00Z')

/** A session that started on that October day, at that time — newest first, as the review reads. */
const on = (day: number, time = '18:00') => ({
  startedAt: new Date(`2026-10-${String(day).padStart(2, '0')}T${time}:00Z`),
})

describe('adherence', () => {
  test('nothing logged: no session, no streak, no gap, and no last session', () => {
    expect(adherenceOf([], 4, NOW)).toEqual({
      sessions: 0,
      perWeek: 0,
      currentStreakDays: 0,
      longestGapDays: 0,
      lastSessionAt: null,
    })
  })

  /** It once said two: the field counts days, and an AI coach reads it as days. */
  test('a morning and an evening session are one day of the streak', () => {
    expect(adherenceOf([on(30, '18:00'), on(30, '07:00')], 4, NOW)).toEqual({
      sessions: 2,
      perWeek: 0.5,
      currentStreakDays: 1,
      longestGapDays: 0,
      lastSessionAt: '2026-10-30T18:00:00.000Z',
    })
  })

  test('training every other day is a streak: one day of rest does not break it', () => {
    const adherence = adherenceOf([on(30), on(28), on(26)], 4, NOW)
    expect([adherence.currentStreakDays, adherence.longestGapDays]).toEqual([3, 2])
  })

  test('two days of rest in a row end it', () => {
    const adherence = adherenceOf([on(30), on(27)], 4, NOW)
    expect([adherence.currentStreakDays, adherence.longestGapDays]).toEqual([1, 3])
  })

  test('a streak whose last session was yesterday is still on; the day before, it is over', () => {
    expect(adherenceOf([on(29), on(28)], 4, NOW).currentStreakDays).toBe(2)
    expect(adherenceOf([on(28), on(27)], 4, NOW).currentStreakDays).toBe(0)
  })

  test('the longest gap is the longest between any two sessions, not the latest', () => {
    const adherence = adherenceOf([on(30), on(29), on(20)], 4, NOW)
    expect([adherence.currentStreakDays, adherence.longestGapDays]).toEqual([2, 9])
  })

  test('sessions a week, to one decimal', () => {
    const five = [on(30), on(28), on(26), on(24), on(22)]
    expect(adherenceOf(five, 3, NOW).perWeek).toBe(1.7)
  })
})
