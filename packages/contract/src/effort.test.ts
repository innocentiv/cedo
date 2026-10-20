import { describe, expect, test } from 'bun:test'
import { formatEffort } from './effort.ts'

const none = { reps: null, weightG: null, durationS: null, distanceMm: null }

describe('formatEffort renders what the tracking mode measures', () => {
  test('a loaded lift is reps × load', () => {
    expect(formatEffort({ ...none, reps: 8, weightG: 60_000 }, 'weight_reps', 'kg')).toBe(
      '8 × 60 kg',
    )
  })

  test('a lift with no load yet is just reps — never "bodyweight" for a barbell', () => {
    expect(formatEffort({ ...none, reps: 8 }, 'weight_reps', 'kg')).toBe('8 reps')
  })

  test('a bodyweight movement is bodyweight, and added load is shown as added', () => {
    expect(formatEffort({ ...none, reps: 10 }, 'bodyweight_reps', 'kg')).toBe('10 × bodyweight')
    expect(formatEffort({ ...none, reps: 6, weightG: 20_000 }, 'bodyweight_reps', 'kg')).toBe(
      '6 × bodyweight +20 kg',
    )
  })

  test('a hold is its duration, not "— × bodyweight"', () => {
    expect(formatEffort({ ...none, durationS: 60 }, 'duration', 'kg')).toBe('1:00')
  })

  test('a run is distance in time', () => {
    expect(
      formatEffort({ ...none, distanceMm: 5_000_000, durationS: 1500 }, 'distance_duration', 'kg'),
    ).toBe('5 km in 25:00')
    expect(formatEffort({ ...none, distanceMm: 400_000 }, 'distance_duration', 'kg')).toBe('400 m')
  })

  test('nothing measured is a dash, not an empty string', () => {
    expect(formatEffort(none, 'duration', 'kg')).toBe('—')
  })

  /**
   * An unavailable exercise: its mode is withheld with its name, so its effort reads as measured —
   * `6 × 20 kg` may have been a weighted pull-up, and claiming "bodyweight +20 kg" or a 20 kg lift
   * would both be a guess. See GLOSSARY.md, "Unavailable exercise".
   */
  test('with no mode known, it renders whatever was measured, and guesses nothing', () => {
    expect(formatEffort({ ...none, reps: 8, weightG: 60_000 }, null, 'kg')).toBe('8 × 60 kg')
    expect(formatEffort({ ...none, reps: 6, weightG: 20_000 }, null, 'kg')).toBe('6 × 20 kg')
    expect(formatEffort({ ...none, durationS: 45 }, null, 'kg')).toBe('0:45')
    expect(formatEffort({ ...none, reps: 12 }, null, 'kg')).toBe('12 reps')
  })

  /** Checked by `tsc`, not at run time: a reader that forgot the mode does not compile. */
  test('the mode cannot be left out — unknown is said, as null', () => {
    // @ts-expect-error -- `undefined` is not a mode, nor a way of saying there is none.
    formatEffort({ ...none, reps: 8 }, undefined, 'kg')
  })
})

describe('in the reader’s unit', () => {
  /** Stored in grams for everyone; a person who reads pounds reads pounds, in every mode. */
  test('a lift, and weight added to bodyweight, read in pounds', () => {
    expect(formatEffort({ ...none, reps: 8, weightG: 61_235 }, 'weight_reps', 'lb')).toBe(
      '8 × 135 lb',
    )
    expect(formatEffort({ ...none, reps: 6, weightG: 9072 }, 'bodyweight_reps', 'lb')).toBe(
      '6 × bodyweight +20 lb',
    )
  })

  test('kilograms unless the reader chose otherwise', () => {
    expect(formatEffort({ ...none, reps: 8, weightG: 60_000 }, 'weight_reps', 'kg')).toBe(
      '8 × 60 kg',
    )
  })
})
