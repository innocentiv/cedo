import { describe, expect, test } from 'bun:test'
import { DIMENSION_FIELDS, type Dimension, fieldsOf } from './dimension.ts'
import { TRACKING_MODES, type TrackingMode } from './exercise.ts'
import { COUNT } from './typing.ts'

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
  test('reps are whole numbers; a point is not a decimal there', () => {
    expect(reps.parse('8')).toEqual({ text: '8', value: 8 })
    expect(reps.parse('1.2')).toEqual({ text: '12', value: 12 })
  })

  test('distance is typed in metres and stored in millimetres', () => {
    expect(distance.parse('1,5')).toEqual({ text: '1.5', value: 1500 })
    expect(distance.toText(100_000)).toBe('100')
  })

  test('every field says its unit', () => {
    expect([reps.unit(), duration.unit(), distance.unit()]).toEqual(['reps', 'm:ss', 'metres'])
  })
})

/**
 * A number pad has no `:`. So, as on a timer, the last two digits are seconds, the two before them
 * minutes, the rest hours — and a bare `90` still means the 90 seconds it always did.
 */
describe('typing a duration', () => {
  test('the last two digits are seconds, the two before them minutes, the rest hours', () => {
    expect(duration.parse('90')).toEqual({ text: '90', value: 90 })
    expect(duration.parse('130')).toEqual({ text: '1:30', value: 90 })
    expect(duration.parse('2500')).toEqual({ text: '25:00', value: 1500 })
    expect(duration.parse('10205')).toEqual({ text: '1:02:05', value: 3725 })
  })

  /** Key by key, the clock grows from the right, and a backspace gives back what it took. */
  test('typed key by key, and taken back, the clock follows the keys', () => {
    expect(['1', '13', '130', '1300'].map((keys) => duration.parse(keys).text)).toEqual([
      '1',
      '13',
      '1:30',
      '13:00',
    ])
    // "1:30" with its last digit deleted is "1:3" — the digits 1 and 3: thirteen seconds.
    expect(duration.parse('1:3')).toEqual({ text: '13', value: 13 })
  })

  test('a separator typed anyway is ignored, so the field reads its own text back', () => {
    expect(duration.parse('1:30')).toEqual({ text: '1:30', value: 90 })
    expect(duration.parse(duration.toText(3725))).toEqual({ text: '1:02:05', value: 3725 })
    expect(duration.parse(duration.toText(45))).toEqual({ text: '45', value: 45 })
  })

  test('seconds past 59 are taken as typed, and read back as a clock', () => {
    expect(duration.parse('190').value).toBe(150)
    expect(duration.toText(150)).toBe('2:30')
  })

  test('empty is null, not zero; a lone zero is zero', () => {
    expect(duration.parse('')).toEqual({ text: '', value: null })
    expect(duration.parse('0')).toEqual({ text: '0', value: 0 })
  })

  test('a number pad, not a decimal one', () => {
    expect(duration.decimals).toBe(false)
  })
})

describe('what parsing does not decide', () => {
  /** The schemas reject an out-of-range value on submit, with a message; the field just types it. */
  test('it enforces no bounds: a 3-tonne weight types as 3 tonnes', () => {
    expect(weight.parse('3000').value).toBe(3_000_000)
    expect(reps.parse('99999').value).toBe(99_999)
  })

  /** `JSON.stringify(Infinity)` is `null`: the API would receive a silently empty field. */
  test('a number too long to be finite is no value, not Infinity', () => {
    const huge = '9'.repeat(400)
    expect(reps.parse(huge)).toEqual({ text: huge, value: null })
    expect(COUNT.parse(huge).value).toBeNull()
  })
})

describe('a plain count', () => {
  test('is a whole number stored as typed, and empty is null', () => {
    expect(COUNT.parse('12')).toEqual({ text: '12', value: 12 })
    expect(COUNT.parse('')).toEqual({ text: '', value: null })
    expect(COUNT.toText(3)).toBe('3')
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
  /** Written out rather than read off the table, so reordering the table has to fail here. */
  const shown: Record<TrackingMode, Dimension[]> = {
    weight_reps: ['weight', 'reps'],
    bodyweight_reps: ['reps', 'weight'],
    duration: ['duration'],
    distance_duration: ['distance', 'duration'],
  }

  test.each(TRACKING_MODES)('%s shows its dimensions in a fixed order', (mode) => {
    expect(fieldsOf(mode).map((f) => f.dimension)).toEqual(shown[mode])
  })

  test('each field names the Effort key it reads and writes', () => {
    expect(Object.values(DIMENSION_FIELDS).map((f) => [f.dimension, f.key])).toEqual([
      ['weight', 'weightG'],
      ['reps', 'reps'],
      ['duration', 'durationS'],
      ['distance', 'distanceMm'],
    ])
  })

  test('and the target it is prescribed as in a plan', () => {
    expect(Object.values(DIMENSION_FIELDS).map((f) => f.targetKey)).toEqual([
      'targetWeightG',
      'targetReps',
      'targetDurationS',
      'targetDistanceMm',
    ])
  })
})
