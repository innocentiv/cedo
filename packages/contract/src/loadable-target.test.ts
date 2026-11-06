import { describe, expect, test } from 'bun:test'
import type { Load } from './load.ts'
import { loadableTarget } from './loadable-target.ts'
import type { SetTarget } from './progression.ts'

const dumbbells: Load = { stepG: 2000, minG: 2000, maxG: 30_000, assisted: false, unit: 'kg' }
const plan = (weightG: number | null): SetTarget => ({
  reps: 8,
  weightG,
  reserve: null,
  durationS: null,
  distanceMm: null,
})

/** How a step lands on loadable weights is take-steps.test.ts's; this is a target as it is shown. */
describe('a prescription as it can be loaded', () => {
  test('22.5 kg on 2 kg dumbbells is 22; no weight, or no load known, is left alone', () => {
    expect(loadableTarget(dumbbells, plan(22_500)).target.weightG).toBe(22_000)
    expect(loadableTarget(dumbbells, plan(null)).target.weightG).toBeNull()
    expect(loadableTarget(null, plan(22_500)).target.weightG).toBe(22_500)
  })

  test('a plan heavier than the heaviest dumbbell is shown at it, and says so', () => {
    expect(loadableTarget(dumbbells, plan(32_500))).toEqual({
      target: plan(30_000),
      limit: 'heaviest',
    })
  })
})
