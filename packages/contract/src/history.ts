import { z } from 'zod'
import { TrackingMode } from './exercise.ts'
import { LoggedEffort } from './log.ts'
import { LoggedDistanceMm, LoggedDurationS, LoggedReps, LoggedWeightG } from './measurement.ts'
import { Id, Timestamp } from './primitives.ts'
import { Reserve } from './rpe.ts'

/**
 * An exercise's history: what someone logged of it, session by session — what its screen, a
 * coach and an AI read, and what a progress chart is drawn from.
 */

/**
 * One past performance of an exercise, grouped by session. This is the shape progression rules
 * consume, and the shape a progress chart will consume later without a schema change.
 */
const ExerciseHistoryEntry = z.object({
  sessionId: Id,
  performedAt: Timestamp,
  sets: z.array(
    z.object({
      setIndex: z.int().nonnegative(),
      weightG: LoggedWeightG.nullable(),
      reps: LoggedReps.nullable(),
      reserve: Reserve.nullable(),
      durationS: LoggedDurationS.nullable(),
      distanceMm: LoggedDistanceMm.nullable(),
      isWarmup: z.boolean(),
    }),
  ),
})

/** Most recent session first. */
export const ExerciseHistory = z.object({
  exerciseId: Id,
  /** So a reader renders the sets in the exercise's terms — `formatEffort(set, tracking, unit)`. */
  tracking: TrackingMode,
  sessions: z.array(ExerciseHistoryEntry),
  /**
   * Whether it has stalled (GLOSSARY.md) — its latest sessions, three or more running, sharing one
   * top set — judged as `training_review` judges it, over the sessions this read returns. The run's
   * length and the top set it is stuck at; null when it has not.
   */
  stalled: z.object({ sessions: z.int().min(1), effort: LoggedEffort }).nullable(),
})
export type ExerciseHistory = z.output<typeof ExerciseHistory>

export const ExerciseHistoryQuery = z.strictObject({
  since: Timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})
export type ExerciseHistoryQuery = z.output<typeof ExerciseHistoryQuery>
