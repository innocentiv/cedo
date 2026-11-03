import { describe, expect, test } from 'bun:test'
import type { Load } from './load.ts'
import type { SetTarget } from './progression.ts'
import { warmupsFor } from './warmup.ts'

/**
 * A warm-up's next session (ADR-0026): its own line, its weight following the working target in
 * proportion — worked out each time, never kept, so editing it restarts nothing.
 */
const set = (reps: number, weightG: number | null): SetTarget => ({
  reps,
  weightG,
  reserve: null,
  durationS: null,
  distanceMm: null,
})
const plates: Load = { stepG: 2500, minG: 20_000, maxG: 200_000, assisted: false, unit: 'kg' }

describe('a warm-up', () => {
  test('follows the working target in proportion: 40 of a 100 plan is 50 of a 125 target', () => {
    expect(warmupsFor([set(10, 40_000)], set(5, 100_000), set(5, 125_000), null)).toEqual([
      set(10, 50_000),
    ])
  })

  test('as the equipment loads it: down to the plate, and up to the bar', () => {
    // 40 × 102.5 / 100 = 41 → 40 on 2.5 kg plates; 10 × … = 10.25 → the 20 kg bar.
    expect(
      warmupsFor([set(10, 40_000), set(10, 10_000)], set(5, 100_000), set(5, 102_500), plates),
    ).toEqual([set(10, 40_000), set(10, 20_000)])
  })

  test('asks what it says while the target is the plan, or when there is no weight to follow', () => {
    expect(warmupsFor([set(10, 40_000)], set(5, 100_000), set(5, 100_000), null)).toEqual([
      set(10, 40_000),
    ])
    expect(warmupsFor([set(10, 40_000)], set(5, null), set(6, null), null)).toEqual([
      set(10, 40_000),
    ])
    expect(warmupsFor([set(10, null)], set(5, 100_000), set(5, 125_000), null)).toEqual([
      set(10, null),
    ])
  })
})
