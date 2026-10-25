import { describe, expect, test } from 'bun:test'
import { asksReserveOf, bySuperset } from './set-marks.ts'
import { musclesByLoad } from './muscle.ts'

describe('reserve, asked of a set', () => {
  test('a working set of an exercise counted in reps — never a warm-up, never a hold', () => {
    expect(asksReserveOf({ isWarmup: false }, 'weight_reps')).toBe(true)
    expect(asksReserveOf({ isWarmup: true }, 'weight_reps')).toBe(false)
    expect(asksReserveOf({ isWarmup: false }, 'duration')).toBe(false)
  })
})

describe('a day in the runs it is done in', () => {
  test('each entry alone, a superset’s consecutive entries together', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
      id,
      superset: [null, 'A', 'A', null, 'B'][i] ?? null,
    }))
    expect(bySuperset(items).map((run) => run.map((i) => i.id))).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
      ['e'],
    ])
  })
})

describe("an exercise's muscles, as read", () => {
  test('most worked first, by name', () => {
    expect(
      musclesByLoad([
        { muscle: 'adductors', loadPct: 10 },
        { muscle: 'quadriceps', loadPct: 60 },
        { muscle: 'gluteus_maximus', loadPct: 30 },
      ]),
    ).toEqual([
      { name: 'Quads', loadPct: 60 },
      { name: 'Glute max', loadPct: 30 },
      { name: 'Adductors', loadPct: 10 },
    ])
  })
})
