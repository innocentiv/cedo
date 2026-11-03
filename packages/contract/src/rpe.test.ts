import { describe, expect, test } from 'bun:test'
import {
  RESERVE_CHOICES,
  Rpe,
  formatReserve,
  formatWithReserve,
  inReserve,
  reserveOf,
  rpeOf,
} from './rpe.ts'

/**
 * The stored scale behind reps in reserve (ADR-0027): 5 to 10, whole — 10 leaving no rep in
 * reserve. A half has no meaning to the person asked, so none is stored.
 */
describe('the RPE scale', () => {
  test.each([5, 6, 8, 10])('accepts %p', (rpe) => {
    expect(Rpe.safeParse(rpe).success).toBe(true)
  })

  test.each([4, 1, 11, 8.5, 7.5, 8.25])('refuses %p', (rpe) => {
    expect(Rpe.safeParse(rpe).success).toBe(false)
  })

  test('says what to send instead, in reps in reserve, when it refuses', () => {
    expect(Rpe.safeParse(8.5).error?.issues[0]?.message).toBe(
      'Reps in reserve are whole, none to five: a range such as 1–2 is asked as its bottom',
    )
  })
})

describe('reps in reserve', () => {
  test('are what an RPE leaves below 10, and back', () => {
    expect(reserveOf(10)).toBe(0)
    expect(reserveOf(8)).toBe(2)
    expect(rpeOf(1)).toBe(9)
    expect(rpeOf(5)).toBe(5)
  })

  /** What a person is asked: none to five reps left, whole — one row under the thumb. */
  test('are offered from none to five, whole, each a valid RPE', () => {
    expect(RESERVE_CHOICES).toEqual([0, 1, 2, 3, 4, 5])
    for (const reserve of RESERVE_CHOICES) expect(Rpe.safeParse(rpeOf(reserve)).success).toBe(true)
  })

  test('read as the whole number they are', () => {
    expect([0, 1, 5].map((reserve) => formatReserve(reserve))).toEqual(['0', '1', '5'])
  })
})

/** How a set's RPE reads beside it, to the person who is asked it as reps in reserve. */
describe('inReserve', () => {
  test('says the reserve an RPE leaves, after a separator', () => {
    expect(inReserve(8)).toBe(' · 2 in reserve')
    expect(inReserve(10)).toBe(' · 0 in reserve')
  })

  test('says nothing for a set without one', () => {
    expect(inReserve(null)).toBe('')
  })
})

/** A set, prescribed or logged, as it reads beside the logger: what it measures, then its reserve. */
describe('formatWithReserve', () => {
  const set = { reps: 5, weightG: 60_000, durationS: null, distanceMm: null }

  test('says the reserve after the effort, when there is an RPE', () => {
    expect(formatWithReserve({ ...set, rpe: 9 }, 'weight_reps', 'kg')).toBe(
      '5 × 60 kg · 1 in reserve',
    )
  })

  test('is the effort alone without one', () => {
    expect(formatWithReserve({ ...set, rpe: null }, 'weight_reps', 'kg')).toBe('5 × 60 kg')
  })
})
