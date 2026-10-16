import { describe, expect, test } from 'bun:test'
import {
  DIMENSIONS_BY_TRACKING,
  DIMENSION_FIELDS,
  type Dimension,
  effortAsTargets,
  fieldsOf,
  targetsAsEffort,
} from './dimension.ts'
import { TRACKING_MODES } from './exercise.ts'

const { weight, reps, duration, distance } = DIMENSION_FIELDS

describe('typing a weight', () => {
  test('a comma is the decimal key on half of Europe’s keypads', () => {
    expect(weight.parse('62,5')).toEqual({ text: '62.5', value: 62_500 })
  })

  /**
   * Regression: rendering from the parsed number collapsed "62." to "62" under the cursor, so 62.5
   * typed key by key logged 625 kg. The text survives; the value is already right.
   */
  test('a trailing point stays on screen while it already means the whole number', () => {
    expect(weight.parse('62.')).toEqual({ text: '62.', value: 62_000 })
  })

  test('an empty field is null, not zero — and so is a lone point', () => {
    expect(weight.parse('')).toEqual({ text: '', value: null })
    expect(weight.parse('.')).toEqual({ text: '.', value: null })
  })

  test('anything but digits and one separator is dropped', () => {
    expect(weight.parse('6a2.5.1 kg')).toEqual({ text: '62.51', value: 62_510 })
  })

  test('on a bodyweight movement it is weight added, so the unit says so', () => {
    expect(weight.unit('bodyweight_reps')).toBe('+kg')
    expect(weight.unit('weight_reps')).toBe('kg')
    // A progression increment has no mode: the plain unit.
    expect(weight.unit()).toBe('kg')
  })
})

describe('the other dimensions', () => {
  test('reps and seconds are whole numbers; a point is not a decimal there', () => {
    expect(reps.parse('8')).toEqual({ text: '8', value: 8 })
    expect(reps.parse('1.2')).toEqual({ text: '12', value: 12 })
    expect(duration.parse('90s')).toEqual({ text: '90', value: 90 })
  })

  test('distance is typed in metres and stored in millimetres', () => {
    expect(distance.parse('1,5')).toEqual({ text: '1.5', value: 1500 })
    expect(distance.toText(100_000)).toBe('100')
  })

  test('every field says its unit', () => {
    expect([reps.unit(), duration.unit(), distance.unit()]).toEqual(['reps', 'seconds', 'metres'])
  })
})

describe('the round trip', () => {
  const values: Record<Dimension, number[]> = {
    weight: [0, 500, 20_000, 62_500, 72_555, 2_000_000],
    reps: [0, 1, 8, 1000],
    duration: [0, 45, 1500, 86_400],
    distance: [0, 1, 1500, 100_000, 5_000_000],
  }

  const dimensions = ['weight', 'reps', 'duration', 'distance'] as const satisfies Dimension[]

  test.each(dimensions)('%s survives text and back exactly', (d) => {
    const field = DIMENSION_FIELDS[d]
    for (const value of values[d]) expect(field.parse(field.toText(value)).value).toBe(value)
    expect(field.toText(null)).toBe('')
  })
})

describe('which fields, in which order', () => {
  test.each(TRACKING_MODES)('%s shows its dimensions in the table’s order', (mode) => {
    expect(fieldsOf(mode).map((f) => f.dimension)).toEqual([...DIMENSIONS_BY_TRACKING[mode]])
  })

  test('each field names the Effort key it reads and writes', () => {
    expect(Object.values(DIMENSION_FIELDS).map((f) => [f.dimension, f.key])).toEqual([
      ['weight', 'weightG'],
      ['reps', 'reps'],
      ['duration', 'durationS'],
      ['distance', 'distanceMm'],
    ])
  })

  test("a set's targets and an Effort map onto each other without loss", () => {
    const targets = {
      targetReps: 8,
      targetWeightG: 60_000,
      targetDurationS: null,
      targetDistanceMm: 1500,
    }
    expect(effortAsTargets(targetsAsEffort(targets))).toEqual(targets)
  })
})
