import { z } from 'zod'
import { TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import { PLAN_WORDS } from './plan-words.ts'
import type { SetTarget } from './progression.ts'
import { Reserve } from './rpe.ts'

/** One set of a plan as it is written — its targets and whether it is a warm-up (workout.ts). */

export const WorkoutSetInput = z.strictObject({
  targetReps: TargetReps.nullable().default(null).describe(PLAN_WORDS.targetReps),
  targetWeightG: TargetWeightG.nullable().default(null).describe(PLAN_WORDS.targetWeightG),
  /** The fewest reps in reserve this set must leave — each working set may ask its own (ADR-0026). */
  targetReserve: Reserve.nullable().default(null).describe(PLAN_WORDS.targetReserve),
  targetDurationS: TargetDurationS.nullable().default(null).describe(PLAN_WORDS.targetDurationS),
  targetDistanceMm: TargetDistanceMm.nullable().default(null).describe(PLAN_WORDS.targetDistanceMm),
  /** Ramp-up sets. Excluded from progression, from working sets per muscle and weight lifted. */
  isWarmup: z.boolean().default(false).describe(PLAN_WORDS.isWarmup),
})
export type WorkoutSetInput = z.output<typeof WorkoutSetInput>

/** A set's targets as a plan is written — `targetReps`, `targetWeightG`, … — without the flag. */
export type TargetFields = Omit<WorkoutSetInput, 'isWarmup'>

/**
 * A set's targets as a plan is written, and as it is read (`target.reps`, …): the one mapping
 * each way. The plan read, progression and `planInputFrom` each spelled it out for themselves.
 */
export const setTargetOf = (set: TargetFields): SetTarget => ({
  reps: set.targetReps,
  weightG: set.targetWeightG,
  reserve: set.targetReserve,
  durationS: set.targetDurationS,
  distanceMm: set.targetDistanceMm,
})

export const targetFieldsOf = (target: SetTarget): TargetFields => ({
  targetReps: target.reps,
  targetWeightG: target.weightG,
  targetReserve: target.reserve,
  targetDurationS: target.durationS,
  targetDistanceMm: target.distanceMm,
})
