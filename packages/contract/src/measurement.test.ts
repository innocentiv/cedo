import { describe, expect, test } from 'bun:test'
import type { z } from 'zod'
import {
  LoggedDistanceMm,
  LoggedDurationS,
  LoggedReps,
  LoggedWeightG,
  MAX_DISTANCE_MM,
  MAX_DURATION_S,
  MAX_REPS,
  MAX_WEIGHT_G,
  Rpe,
  TargetWeightG,
} from './measurement.ts'
import { SetTarget } from './progression.ts'
import { LogSetInput } from './log.ts'
import { WorkoutSetInput } from './workout.ts'

/** Postgres `integer`. Every measurement bound must fit, or a valid value overflows the column. */
const PG_INT4_MAX = 2_147_483_647

describe('every measurement bound fits the int4 column behind it', () => {
  test.each([
    ['weight', MAX_WEIGHT_G],
    ['reps', MAX_REPS],
    ['duration', MAX_DURATION_S],
    ['distance', MAX_DISTANCE_MM],
  ])('%s', (_name, max) => {
    expect(max).toBeLessThanOrEqual(PG_INT4_MAX)
  })
})

/**
 * Regression: `weightG` was the only dimension without an upper bound, so a value that passed
 * validation reached the INSERT and Postgres raised "value out of range for type integer" —
 * an unhandled 500 from a request the contract had accepted.
 */
describe('weight is bounded everywhere it appears', () => {
  const overflow = 3_000_000_000

  test('the shared schemas reject it', () => {
    expect(LoggedWeightG.safeParse(overflow).success).toBe(false)
    expect(TargetWeightG.safeParse(overflow).success).toBe(false)
  })

  test.each([
    [
      'SetTarget',
      SetTarget,
      { reps: null, weightG: overflow, rpe: null, durationS: null, distanceMm: null },
    ],
    ['WorkoutSetInput', WorkoutSetInput, { targetWeightG: overflow }],
    ['LogSetInput', LogSetInput, { exerciseId: crypto.randomUUID(), weightG: overflow }],
  ] as const)('%s rejects an int4 overflow', (_name, schema: z.ZodType, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })

  test('but accepts a plausible heavy load', () => {
    expect(LoggedWeightG.safeParse(500_000).success).toBe(true)
  })
})

describe('bounds are shared, not redeclared', () => {
  /**
   * Regression: the five dimensions were spelled out separately in progression.ts, workout.ts and
   * log.ts, and had already drifted — history rows validated more loosely than the log rows they
   * were read from.
   */
  test('logged and history schemas enforce the same maxima', () => {
    const tooMany = MAX_REPS + 1
    expect(LoggedReps.safeParse(tooMany).success).toBe(false)
    expect(LoggedDurationS.safeParse(MAX_DURATION_S + 1).success).toBe(false)
    expect(LoggedDistanceMm.safeParse(MAX_DISTANCE_MM + 1).success).toBe(false)
  })

  test('logged values allow zero; a failed set still happened', () => {
    expect(LoggedReps.safeParse(0).success).toBe(true)
    expect(LoggedWeightG.safeParse(0).success).toBe(true)
  })

  test('rpe is 1-10 wherever it appears', () => {
    expect(Rpe.safeParse(0).success).toBe(false)
    expect(Rpe.safeParse(11).success).toBe(false)
    expect(Rpe.safeParse(10).success).toBe(true)
  })
})
