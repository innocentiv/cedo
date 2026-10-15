import { describe, expect, test } from 'bun:test'
import { formatEffort } from './effort.ts'

const none = { reps: null, weightG: null, durationS: null, distanceMm: null }

describe('formatEffort renders what the tracking mode measures', () => {
  test('a loaded lift is reps × load', () => {
    expect(formatEffort({ ...none, reps: 8, weightG: 60_000 }, 'weight_reps')).toBe('8 × 60 kg')
  })

  test('a lift with no load yet is just reps — never "bodyweight" for a barbell', () => {
    expect(formatEffort({ ...none, reps: 8 }, 'weight_reps')).toBe('8 reps')
  })

  test('a bodyweight movement is bodyweight, and added load is shown as added', () => {
    expect(formatEffort({ ...none, reps: 10 }, 'bodyweight_reps')).toBe('10 × bodyweight')
    expect(formatEffort({ ...none, reps: 6, weightG: 20_000 }, 'bodyweight_reps')).toBe(
      '6 × bodyweight +20 kg',
    )
  })

  test('a hold is its duration, not "— × bodyweight"', () => {
    expect(formatEffort({ ...none, durationS: 60 }, 'duration')).toBe('1m 0s')
  })

  test('a run is distance in time', () => {
    expect(
      formatEffort({ ...none, distanceMm: 5_000_000, durationS: 1500 }, 'distance_duration'),
    ).toBe('5 km in 25m 0s')
    expect(formatEffort({ ...none, distanceMm: 400_000 }, 'distance_duration')).toBe('400 m')
  })

  test('nothing measured is a dash, not an empty string', () => {
    expect(formatEffort(none, 'duration')).toBe('—')
  })

  test('with no mode known, it renders whatever was measured', () => {
    expect(formatEffort({ ...none, reps: 8, weightG: 60_000 })).toBe('8 × 60 kg')
    expect(formatEffort({ ...none, durationS: 45 })).toBe('45s')
    expect(formatEffort({ ...none, reps: 12 })).toBe('12 reps')
  })
})
