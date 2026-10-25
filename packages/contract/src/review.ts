import { z } from 'zod'
import { LoggedEffort, LoggedExercise } from './log.ts'
import { Timestamp } from './primitives.ts'
import { Rpe } from './rpe.ts'

/**
 * The training review (#28): what a coach would look at, read in one call — by an AI through
 * `training_review`, and by the athlete on the Progress tab, over HTTP. Aggregation over what is
 * logged, judged by the rules in GLOSSARY.md ("Stalled", "Falling", "Effort drift", "Declined
 * muscle"), never new rules here. See docs/07-mcp.md and the API's `review/service.ts`.
 */

/** `GET /review` — how many weeks back to look; the period before is compared against. */
export const ReviewQuery = z.strictObject({
  weeks: z.coerce.number().int().min(1).max(52).default(8),
})
export type ReviewQuery = z.output<typeof ReviewQuery>

/**
 * The work one muscle got, in WORKING SETS by its share of each exercise's load — a set of a 70/30
 * exercise is 0.7 here — so every tracking mode counts alike; and what was lifted, for loaded work.
 */
export const MuscleWork = z.object({
  /** Its slug (`MUSCLES`). */
  muscle: z.string(),
  /** To one decimal; `changePct` compares the unrounded sums. */
  weightedSets: z.number().nonnegative(),
  /** Weight × reps, in grams — 0 for work that carries no load. */
  liftedG: z.int().nonnegative(),
  /** Against the period before; null when that period had none. */
  changePct: z.int().nullable(),
})
export type MuscleWork = z.output<typeof MuscleWork>

/** A top set and, when one was said, how hard it was: a stall's set is worth both. */
export const RatedEffort = LoggedEffort.extend({ rpe: Rpe.nullable().optional() })
export type RatedEffort = z.output<typeof RatedEffort>

export const TrainingReview = z.object({
  weeks: z.int().positive(),
  adherence: z.object({
    sessions: z.int().nonnegative(),
    perWeek: z.number().nonnegative(),
    currentStreakDays: z.int().nonnegative(),
    longestGapDays: z.int().nonnegative(),
    lastSessionAt: Timestamp.nullable(),
  }),
  /** Which planned days get trained, and so which get skipped. */
  dayBalance: z.array(z.object({ day: z.string(), workout: z.string(), sessions: z.int() })),
  muscleWork: z.object({
    /** The muscles worked most, most first. */
    top: z.array(MuscleWork),
    /** Declined muscles not already in `top`, the most sets lost first. */
    declined: z.array(MuscleWork),
    /** Muscles worked in either period that neither list names. */
    omitted: z.int().nonnegative(),
  }),
  /** The same top set, sessions running: change something. */
  stalled: z.array(
    z.object({ exercise: LoggedExercise, sessions: z.int().positive(), effort: RatedEffort }),
  ),
  /** A weight lift's estimated max falling, session after session. */
  falling: z.array(
    z.object({
      exercise: LoggedExercise,
      sessions: z.int().positive(),
      fromG: z.int(),
      toG: z.int(),
    }),
  ),
  /** The same set rated harder each time. */
  effortDrift: z.array(
    z.object({
      exercise: LoggedExercise,
      effort: LoggedEffort,
      fromRpe: z.number(),
      toRpe: z.number(),
    }),
  ),
})
export type TrainingReview = z.output<typeof TrainingReview>
