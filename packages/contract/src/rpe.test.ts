import { describe, expect, test } from 'bun:test'
import {
  RESERVE_CHOICES,
  RPE_MAX,
  RPE_MIN,
  Reserve,
  formatReserve,
  formatWithReserve,
  inReserve,
  reserveOf,
  rpeOf,
} from './rpe.ts'

/**
 * Reps in reserve (ADR-0027): none to five, whole — the one rating of how hard a set was, for a
 * person and an AI alike. A half means nothing to the person asked, so none is accepted.
 */
describe('reps in reserve', () => {
  test.each([0, 1, 3, 5])('accepts %p', (reserve) => {
    expect(Reserve.safeParse(reserve).success).toBe(true)
  })

  test.each([-1, 6, 1.5, 2.5, 0.25])('refuses %p', (reserve) => {
    expect(Reserve.safeParse(reserve).success).toBe(false)
  })

  test('says what to send instead when it refuses', () => {
    expect(Reserve.safeParse(1.5).error?.issues[0]?.message).toBe(
      'Reps in reserve are whole, none to five: a range such as 1–2 is asked as its bottom',
    )
  })

  /** What a person is asked: none to five reps left, whole — one row under the thumb. */
  test('are offered from none to five, each one the scale accepts', () => {
    expect(RESERVE_CHOICES).toEqual([0, 1, 2, 3, 4, 5])
    for (const reserve of RESERVE_CHOICES) expect(Reserve.safeParse(reserve).success).toBe(true)
  })

  test('read as the whole number they are', () => {
    expect([0, 1, 5].map((reserve) => formatReserve(reserve))).toEqual(['0', '1', '5'])
  })
})

/** The stored scale, the one place RPE survives: ten minus the reserve, and back. */
describe('the stored RPE', () => {
  test('is ten minus the reserve, and back', () => {
    expect(rpeOf(0)).toBe(10)
    expect(rpeOf(2)).toBe(8)
    expect(reserveOf(9)).toBe(1)
    expect(reserveOf(5)).toBe(5)
  })

  test('covers every reserve a person can be asked, and no more', () => {
    expect(RESERVE_CHOICES.map((reserve) => rpeOf(reserve))).toEqual([10, 9, 8, 7, 6, 5])
    expect([RPE_MIN, RPE_MAX]).toEqual([5, 10])
  })
})

describe('inReserve', () => {
  test('says the reserve after a separator', () => {
    expect(inReserve(2)).toBe(' · 2 in reserve')
    expect(inReserve(0)).toBe(' · 0 in reserve')
  })

  test('says nothing for a set without one', () => {
    expect(inReserve(null)).toBe('')
  })
})

/** A set, prescribed or logged, as it reads beside the logger: what it measures, then its reserve. */
describe('formatWithReserve', () => {
  const set = { reps: 5, weightG: 60_000, durationS: null, distanceMm: null }

  test('says the reserve after the effort, when there is one', () => {
    expect(formatWithReserve({ ...set, reserve: 1 }, 'weight_reps', 'kg')).toBe(
      '5 × 60 kg · 1 in reserve',
    )
  })

  test('is the effort alone without one', () => {
    expect(formatWithReserve({ ...set, reserve: null }, 'weight_reps', 'kg')).toBe('5 × 60 kg')
  })
})
