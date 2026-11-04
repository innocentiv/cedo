import { describe, expect, test } from 'bun:test'
import {
  type Effort,
  compareEfforts,
  formatEffort,
  formatSets,
  startingEffort,
  topSet,
} from './effort.ts'
import { lbToG } from './units.ts'

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

  /** Assistance — a band, an assisted machine — is negative added weight, and said as such (#19). */
  test('assistance reads as assistance, never as "+-20 kg"', () => {
    expect(formatEffort({ ...none, reps: 12, weightG: -20_000 }, 'bodyweight_reps', 'kg')).toBe(
      '12 × bodyweight −20 kg (assisted)',
    )
    expect(
      formatSets(
        [
          { ...none, reps: 12, weightG: -20_000 },
          { ...none, reps: 10, weightG: -20_000 },
        ],
        'bodyweight_reps',
        'kg',
      ),
    ).toBe('12, 10 × bodyweight −20 kg (assisted)')
  })

  /** One scale: less assistance is better, then no help, then added load. */
  test('less assistance is the better set, and added load better still', () => {
    const at = (weightG: number | null): Effort => ({ ...none, reps: 8, weightG })
    const ladder = [at(-20_000), at(-10_000), at(null), at(5_000)]
    for (const [lower, higher] of ladder.slice(1).map((e, i) => [ladder[i], e] as const)) {
      if (lower === undefined) continue
      expect(compareEfforts(higher, lower, 'bodyweight_reps')).toBeGreaterThan(0)
    }
    expect(topSet([at(-20_000), at(-10_000)], 'bodyweight_reps')).toEqual(at(-10_000))
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

/** A session's best working set, as its tracking mode ranks efforts. See `topSet`. */
describe('the top set', () => {
  const set = (effort: Partial<Effort>): Effort => ({ ...none, ...effort })

  test('a lift: the heaviest weight, then the most reps at it', () => {
    const sets = [
      set({ reps: 10, weightG: 60_000 }),
      set({ reps: 5, weightG: 80_000 }),
      set({ reps: 6, weightG: 80_000 }),
    ]
    expect(topSet(sets, 'weight_reps')).toEqual(set({ reps: 6, weightG: 80_000 }))
  })

  test('bodyweight: the most added weight — none is nothing added — then the most reps', () => {
    const sets = [
      set({ reps: 12 }),
      set({ reps: 6, weightG: 10_000 }),
      set({ reps: 8, weightG: 0 }),
    ]
    expect(topSet(sets, 'bodyweight_reps')).toEqual(set({ reps: 6, weightG: 10_000 }))
    expect(topSet([set({ reps: 12 }), set({ reps: 8, weightG: 0 })], 'bodyweight_reps')).toEqual(
      set({ reps: 12 }),
    )
  })

  test('a hold: the longest', () => {
    expect(topSet([set({ durationS: 45 }), set({ durationS: 60 })], 'duration')).toEqual(
      set({ durationS: 60 }),
    )
  })

  test('a run: the farthest, then the fastest over it', () => {
    const sets = [
      set({ distanceMm: 5_000_000, durationS: 1500 }),
      set({ distanceMm: 5_000_000, durationS: 1400 }),
      set({ distanceMm: 3_000_000, durationS: 600 }),
    ]
    expect(topSet(sets, 'distance_duration')).toEqual(
      set({ distanceMm: 5_000_000, durationS: 1400 }),
    )
  })

  test('a dimension not measured counts as least, and no sets have no top set', () => {
    expect(topSet([set({ reps: 8 }), set({ reps: 5, weightG: 40_000 })], 'weight_reps')).toEqual(
      set({ reps: 5, weightG: 40_000 }),
    )
    expect(topSet<Effort>([], 'weight_reps')).toBeUndefined()
  })

  test('efforts the mode measures alike are the same: no added weight is "+0 kg"', () => {
    expect(compareEfforts(set({ reps: 8 }), set({ reps: 8, weightG: 0 }), 'bodyweight_reps')).toBe(
      0,
    )
    // A dimension the mode does not measure plays no part.
    expect(
      compareEfforts(set({ durationS: 60 }), set({ durationS: 60, reps: 3 }), 'duration'),
    ).toBe(0)
    expect(compareEfforts(set({ reps: 9 }), set({ reps: 8, weightG: 0 }), 'bodyweight_reps')).toBe(
      1,
    )
  })
})

/** "Last time", in one line: a session's working sets of one exercise, as logged. */
describe('formatSets', () => {
  const set = (reps: number | null, weightG: number | null, durationS: number | null = null) => ({
    reps,
    weightG,
    durationS,
    distanceMm: null,
  })

  test('sets of one weight read as their reps, then the weight once', () => {
    expect(formatSets([set(8, 60_000), set(8, 60_000), set(7, 60_000)], 'weight_reps', 'kg')).toBe(
      '8, 8, 7 × 60 kg',
    )
  })

  test('sets of different weights read one by one', () => {
    expect(formatSets([set(8, 60_000), set(6, 65_000)], 'weight_reps', 'kg')).toBe(
      '8 × 60 kg, 6 × 65 kg',
    )
  })

  test('bodyweight sets keep their mode, with or without added weight', () => {
    expect(formatSets([set(10, null), set(9, null)], 'bodyweight_reps', 'kg')).toBe(
      '10, 9 × bodyweight',
    )
    expect(formatSets([set(6, 20_000), set(5, 20_000)], 'bodyweight_reps', 'kg')).toBe(
      '6, 5 × bodyweight +20 kg',
    )
  })

  /** Nothing added, logged as 0 or as nothing, is one weight: bodyweight. */
  test('bodyweight with nothing added reads as one weight, however it was logged', () => {
    expect(formatSets([set(10, 0), set(9, null)], 'bodyweight_reps', 'kg')).toBe(
      '10, 9 × bodyweight',
    )
  })

  test('sets without reps — holds — read one by one', () => {
    expect(formatSets([set(null, null, 60), set(null, null, 45)], 'duration', 'kg')).toBe(
      '1:00, 0:45',
    )
  })

  test('in the reader’s unit', () => {
    expect(formatSets([set(5, lbToG(135)), set(5, lbToG(135))], 'weight_reps', 'lb')).toBe(
      '5, 5 × 135 lb',
    )
  })

  test('no sets is a dash', () => {
    expect(formatSets([], 'weight_reps', 'kg')).toBe('—')
  })
})

/**
 * What the logger starts a set from: what it asks. A bodyweight movement asked for no weight starts
 * at none added — 0 kg, which − and + step from — not an empty field.
 */
describe('the numbers a set starts from', () => {
  test('a bodyweight movement asked for no weight starts at none added', () => {
    expect(startingEffort({ ...none, reps: 8 }, 'bodyweight_reps')).toEqual({
      ...none,
      reps: 8,
      weightG: 0,
    })
  })

  test('what is asked is kept: assistance, added load, and any other mode as it is', () => {
    const assisted = { ...none, reps: 8, weightG: -7500 }
    expect(startingEffort(assisted, 'bodyweight_reps')).toEqual(assisted)
    // A lift with no load yet has none to start from: its weight is the athlete's to say.
    expect(startingEffort({ ...none, reps: 8 }, 'weight_reps')).toEqual({ ...none, reps: 8 })
  })
})
