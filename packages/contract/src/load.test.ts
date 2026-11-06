import { describe, expect, test } from 'bun:test'
import type { AthleteEquipment } from './athlete-equipment.ts'
import { type Load, loadOf, loadable, steppedOn } from './load.ts'
import { formatWeight, lbToG } from './units.ts'

const dumbbells: Load = { stepG: 2000, minG: 2000, maxG: 30_000, assisted: false, unit: 'kg' }
const barbell: Load = { stepG: 2500, minG: 20_000, maxG: null, assisted: false, unit: 'kg' }
const belt: Load = { stepG: 5000, minG: null, maxG: 40_000, assisted: true, unit: 'kg' }

const held = (items: AthleteEquipment['items']): AthleteEquipment => ({ described: true, items })

describe("an exercise's load", () => {
  test('is the weights of the one item that holds it', () => {
    const mine = held([
      { slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } },
      { slug: 'flat_bench', weights: null },
    ])
    const press = {
      equipment: ['dumbbells', 'flat_bench'] as const,
      tracking: 'weight_reps' as const,
    }
    expect(loadOf({ ...press, equipment: [...press.equipment] }, mine, 'kg')).toEqual(dumbbells)
  })

  test('is not known without the item, its weights, or a description — and nothing snaps', () => {
    const squat = {
      equipment: ['barbell' as const, 'rack' as const],
      tracking: 'weight_reps' as const,
    }
    expect(loadOf(squat, held([]), 'kg')).toBeNull()
    expect(loadOf(squat, held([{ slug: 'barbell', weights: null }]), 'kg')).toBeNull()
    expect(loadOf({ ...squat, equipment: null }, held([]), 'kg')).toBeNull()
    expect(loadable(null, 22_500)).toEqual({ weightG: 22_500, limit: null })
  })

  test('on a bodyweight movement is the weight belt: from nothing, assistance below', () => {
    const pullUp = { equipment: ['pull_up_bar' as const], tracking: 'bodyweight_reps' as const }
    const mine = held([{ slug: 'weight_belt', weights: { stepG: 5000, minG: 0, maxG: 40_000 } }])
    expect(loadOf(pullUp, mine, 'kg')).toEqual(belt)
    expect(loadOf(pullUp, held([]), 'kg')).toBeNull()
  })

  test('is nothing to a hold or a run', () => {
    const plank = { equipment: [], tracking: 'duration' as const }
    expect(
      loadOf(
        plank,
        held([{ slug: 'weight_belt', weights: { stepG: 5000, minG: 0, maxG: null } }]),
        'kg',
      ),
    ).toBeNull()
  })
})

describe('stepping', () => {
  test('dumbbells that go 2 kg at a time: 20, 22, 24', () => {
    expect(steppedOn(dumbbells, 20_000, 1)).toBe(22_000)
    expect(steppedOn(dumbbells, 22_000, -1)).toBe(20_000)
  })

  test('from a weight typed between two, to the one beside it', () => {
    expect(steppedOn(dumbbells, 21_000, 1)).toBe(22_000)
    expect(steppedOn(dumbbells, 21_000, -1)).toBe(20_000)
  })

  test('stops at the lightest and the heaviest; an empty field steps from nothing', () => {
    expect(steppedOn(dumbbells, 30_000, 1)).toBe(30_000)
    expect(steppedOn(dumbbells, 2000, -1)).toBe(2000)
    expect(steppedOn(dumbbells, null, 1)).toBe(2000)
    expect(steppedOn(barbell, 20_000, -1)).toBe(20_000)
  })

  test('a heaviest off the grid stops at the last weight under it', () => {
    expect(steppedOn({ ...dumbbells, maxG: 31_000 }, 30_000, 1)).toBe(30_000)
  })

  test('a belt steps its added weight, and on down into assistance, uncapped below', () => {
    expect(steppedOn(belt, 0, 1)).toBe(5000)
    expect(steppedOn(belt, 0, -1)).toBe(-5000)
    expect(steppedOn(belt, -20_000, -1)).toBe(-25_000)
    expect(steppedOn(belt, 40_000, 1)).toBe(40_000)
  })
})

describe('a target as it can be loaded', () => {
  test('the heaviest weight not above it: 22.5 on 2 kg dumbbells is 22', () => {
    expect(loadable(dumbbells, 22_500)).toEqual({ weightG: 22_000, limit: null })
    expect(loadable(dumbbells, 22_000)).toEqual({ weightG: 22_000, limit: null })
    expect(loadable(barbell, 61_000)).toEqual({ weightG: 60_000, limit: null })
  })

  test('at or above the heaviest it is the heaviest, and says so', () => {
    expect(loadable(dumbbells, 32_500)).toEqual({ weightG: 30_000, limit: 'heaviest' })
    expect(loadable(dumbbells, 30_500)).toEqual({ weightG: 30_000, limit: 'heaviest' })
    // #66: there is nothing heavier to move to — the reason a target stops moving.
    expect(loadable(dumbbells, 30_000)).toEqual({ weightG: 30_000, limit: 'heaviest' })
    expect(loadable(dumbbells, 29_000)).toEqual({ weightG: 28_000, limit: null })
  })

  test('with no heaviest, never at it', () => {
    expect(loadable(barbell, 300_000)).toEqual({ weightG: 300_000, limit: null })
  })

  test('under the lightest it is the lightest — nothing lighter exists — and says so', () => {
    expect(loadable(dumbbells, 1000)).toEqual({ weightG: 2000, limit: 'lightest' })
    expect(loadable(barbell, 15_000)).toEqual({ weightG: 20_000, limit: 'lightest' })
  })

  test('assistance is loaded as the belt steps it, never floored', () => {
    expect(loadable(belt, -12_500)).toEqual({ weightG: -15_000, limit: null })
    expect(loadable(belt, 7500)).toEqual({ weightG: 5000, limit: null })
  })
})

/**
 * In pounds, every step is stored in whole grams — 5 lb is 2268 g, a fraction heavy — so the grid
 * drifts off the weights as typed: read exactly, 135 lb on a 45 lb bar was a whole plate short.
 */
describe('in pounds', () => {
  const bar: Load = { stepG: lbToG(5), minG: lbToG(45), maxG: null, assisted: false, unit: 'lb' }
  const shown = (grams: number) => formatWeight(grams, 'lb')

  test('a plan of whole plates is shown as it is', () => {
    for (const lb of [95, 135, 185, 225, 315]) {
      expect(shown(loadable(bar, lbToG(lb)).weightG)).toBe(`${lb} lb`)
    }
  })

  test('+ from a weight typed in pounds goes one plate up, − one down', () => {
    expect(shown(steppedOn(bar, lbToG(135), 1))).toBe('140 lb')
    expect(shown(steppedOn(bar, lbToG(135), -1))).toBe('130 lb')
  })

  test('the heaviest dumbbell is the heaviest, not one short of it', () => {
    const lbDumbbells: Load = {
      stepG: lbToG(5),
      minG: lbToG(5),
      maxG: lbToG(100),
      assisted: false,
      unit: 'lb',
    }
    expect(loadable(lbDumbbells, lbToG(100)).limit).toBe('heaviest')
    expect(shown(loadable(lbDumbbells, lbToG(100)).weightG)).toBe('100 lb')
    expect(loadable(lbDumbbells, lbToG(95)).limit).toBeNull()
    expect(loadable(lbDumbbells, lbToG(105)).limit).toBe('heaviest')
  })
})

describe('the buttons, outside the weights there are', () => {
  test('− under the lightest, and + over the heaviest, leave the weight typed as it is', () => {
    expect(steppedOn(dumbbells, 1000, -1)).toBe(1000)
    expect(steppedOn({ ...dumbbells, maxG: 24_000 }, 30_000, 1)).toBe(30_000)
  })

  test('the other way, they come back to the weights there are', () => {
    expect(steppedOn(dumbbells, 1000, 1)).toBe(2000)
    expect(steppedOn({ ...dumbbells, maxG: 24_000 }, 30_000, -1)).toBe(24_000)
  })
})
