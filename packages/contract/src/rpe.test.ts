import { describe, expect, test } from 'bun:test'
import { RESERVE_CHOICES, Rpe, formatReserve, inReserve, reserveOf, rpeOf } from './rpe.ts'

/** RPE as GLOSSARY.md defines it: 5 to 10 in half-points, 10 leaving no rep in reserve. */
describe('the RPE scale', () => {
  test.each([5, 6.5, 8, 8.5, 10])('accepts %p', (rpe) => {
    expect(Rpe.safeParse(rpe).success).toBe(true)
  })

  test.each([4.5, 1, 10.5, 8.25, 7.1])('refuses %p', (rpe) => {
    expect(Rpe.safeParse(rpe).success).toBe(false)
  })

  test('says what it accepts, when it refuses', () => {
    expect(Rpe.safeParse(8.25).error?.issues[0]?.message).toBe('RPE is 5 to 10, in half-points')
  })
})

describe('reps in reserve', () => {
  test('are what an RPE leaves below 10, and back', () => {
    expect(reserveOf(10)).toBe(0)
    expect(reserveOf(8.5)).toBe(1.5)
    expect(rpeOf(1)).toBe(9)
    expect(rpeOf(0.5)).toBe(9.5)
  })

  /** What a person is asked: none to five reps left, in halves — every RPE on the scale, once. */
  test('are offered from none to five, in halves, each a valid RPE', () => {
    expect(RESERVE_CHOICES).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])
    for (const reserve of RESERVE_CHOICES) expect(Rpe.safeParse(rpeOf(reserve)).success).toBe(true)
  })

  test('read with a half as ½', () => {
    expect([0, 0.5, 1, 1.5, 5].map((reserve) => formatReserve(reserve))).toEqual([
      '0',
      '½',
      '1',
      '1½',
      '5',
    ])
  })
})

/** How a set's RPE reads beside it, to the person who is asked it as reps in reserve. */
describe('inReserve', () => {
  test('says the reserve an RPE leaves, after a separator', () => {
    expect(inReserve(8)).toBe(' · 2 in reserve')
    expect(inReserve(8.5)).toBe(' · 1½ in reserve')
    expect(inReserve(10)).toBe(' · 0 in reserve')
  })

  test('says nothing for a set without one', () => {
    expect(inReserve(null)).toBe('')
  })
})
