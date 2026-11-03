import { z } from 'zod'
import { TrackingMode } from './exercise.ts'
import { TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import { Reserve } from './rpe.ts'

/**
 * How a set's targets advance over time. Stored as JSONB on `workout_entries`, so adding a rule
 * kind means extending this union and `progress` — never a migration.
 * See docs/adr/0012-progression-rules.md.
 */

export const Progression = z.discriminatedUnion('kind', [
  /** Targets never change automatically; the user or the AI sets them explicitly. */
  z.object({
    kind: z
      .literal('none')
      .describe(
        'Manual: the sets are the plan’s numbers and nothing moves them — to change them, change ' +
          'the plan. Sets may differ freely (a top set and back-offs).',
      ),
  }),

  /**
   * Add weight once the target has been met for `afterSuccesses` consecutive sessions.
   * Classic linear periodisation — the right default for novices.
   */
  z.object({
    kind: z
      .literal('linear')
      .describe(
        'Add weight once every working set met its reps at its weight, leaving no fewer reps in ' +
          'reserve than it asked, for `afterSuccesses` sessions running. Weight-and-reps exercises.',
      ),
    incrementG: z
      .int()
      .positive()
      .max(50_000)
      .describe('Weight added at each advance, in grams (2.5 kg is 2500).'),
    afterSuccesses: z
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe(
        'Cleared sessions in a row an advance waits for. Default 1: every cleared session advances.',
      ),
  }),

  /**
   * Work reps up through a range at a fixed weight; on clearing the top of the range, add weight
   * and drop back to the bottom. The standard hypertrophy scheme.
   */
  z.object({
    kind: z
      .literal('double')
      .describe(
        'Double progression: one rep more after each cleared session, at the same weight, up ' +
          'through `repRange`; once every working set clears its top, add `incrementG` and start ' +
          'again at its bottom. Weight-and-reps exercises.',
      ),
    repRange: z
      .tuple([z.int().min(1).max(100), z.int().min(1).max(100)])
      .describe(
        '[from, to] reps, `from` below `to`. Every working set’s `targetReps` sits inside it — ' +
          'it is where each follower starts.',
      ),
    incrementG: z
      .int()
      .positive()
      .max(50_000)
      .describe('Weight added at each advance, in grams (2.5 kg is 2500).'),
  }),

  /**
   * Hold for longer. For `duration` exercises — planks, dead hangs, loaded carries — where
   * progression is time under load rather than weight on the bar.
   */
  z.object({
    kind: z
      .literal('linear_duration')
      .describe(
        'Hold for longer: add `incrementS` once every working set lasted its duration, for ' +
          '`afterSuccesses` sessions running. Duration exercises (a plank, a dead hang).',
      ),
    incrementS: z.int().positive().max(3600).describe('Seconds added at each advance.'),
    afterSuccesses: z
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe(
        'Cleared sessions in a row an advance waits for. Default 1: every cleared session advances.',
      ),
  }),

  /**
   * Go further at the same pace. For `distance_duration` exercises — runs, rows — where the time
   * grows with the distance, so a volume step is never a pace jump (#14). Going faster stays a
   * deliberate change: a shorter time would break advance-or-hold.
   */
  z.object({
    kind: z
      .literal('linear_distance')
      .describe(
        'Go further at the same pace: add `incrementMm`, and time in proportion, once every ' +
          'working set covered its distance within its pace, for `afterSuccesses` sessions ' +
          'running. Distance-and-duration exercises (a run, a row).',
      ),
    incrementMm: z
      .int()
      .positive()
      .max(10_000_000)
      .describe('Distance added at each advance, in millimetres (500 m is 500000).'),
    afterSuccesses: z
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe(
        'Cleared sessions in a row an advance waits for. Default 1: every cleared session advances.',
      ),
  }),
])
export type Progression = z.output<typeof Progression>

export const PROGRESSION_KINDS = [
  'none',
  'linear',
  'double',
  'linear_duration',
  'linear_distance',
] as const

export const NO_PROGRESSION: Progression = { kind: 'none' }

/**
 * What a set prescribes. Every dimension is nullable: which ones are meaningful depends on the
 * exercise's `tracking` mode (see exercise.ts). A plank prescribes only `durationS`; a squat
 * prescribes `reps` and `weightG`.
 */
export const SetTarget = z.object({
  reps: TargetReps.nullable(),
  weightG: TargetWeightG.nullable(),
  /** The fewest reps in reserve the set must leave: a floor, not an aim (#45, ADR-0027). */
  reserve: Reserve.nullable(),
  durationS: TargetDurationS.nullable(),
  distanceMm: TargetDistanceMm.nullable(),
})
export type SetTarget = z.output<typeof SetTarget>

/** A set asked for nothing in particular: a first set of an exercise with no plan, no history. */
export const NO_TARGET: SetTarget = {
  reps: null,
  weightG: null,
  reserve: null,
  durationS: null,
  distanceMm: null,
}

/**
 * Why a rule held a prescription (#45) — the glossary's "Held" — named by the working set that held
 * it (ADR-0026), counted from 1, so it reads as the logger says it ("held: set 3 did 7 of 10"):
 * short of its `targets`, the first set that was, with what it `did` (null: not done) and what it
 * was `asked`; or ground out past its own reserve (`effort`), the set that left the fewest, with
 * the `reserve` it left and the reserve it `asked`. Null when the rule advanced, or had nothing to
 * hold it for: no history, no rule, nothing left to add, or a ceiling. Not a timed set, which the
 * glossary also calls a hold.
 */
export const Held = z.discriminatedUnion('reason', [
  z.object({
    reason: z.literal('targets'),
    set: z.int().positive(),
    did: SetTarget.nullable(),
    asked: SetTarget,
  }),
  z.object({
    reason: z.literal('effort'),
    set: z.int().positive(),
    reserve: Reserve,
    asked: Reserve,
  }),
])
export type Held = z.output<typeof Held>

/**
 * What `progress` proposes for one workout entry, alongside what it proposes to change from.
 * Returned by `GET /workouts/:id/progression` and by the `workout_progression` MCP tool — the AI's
 * entry point for "evaluate my progression and set next week's numbers".
 */
export const ProgressionSuggestion = z.object({
  entryId: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  /** So a reader renders targets in the exercise's terms — `formatEffort(target, tracking, unit)`. */
  tracking: TrackingMode,
  rule: Progression,
  current: SetTarget,
  suggested: SetTarget,
  /** False when the rule held rather than advanced. */
  changed: z.boolean(),
  /** Why it held, when something held it — so a prescription held for effort is not read as a stall. */
  held: Held.nullable(),
  /** How many past sessions were considered. Zero means there is no history to judge from. */
  sessionsConsidered: z.int().nonnegative(),
})
export type ProgressionSuggestion = z.output<typeof ProgressionSuggestion>

/** One logged set. Every measurement is optional; only what the exercise tracks is recorded. */
export interface SetAttempt {
  readonly weightG?: number | null
  readonly reps?: number | null
  readonly durationS?: number | null
  readonly distanceMm?: number | null
  /** How many reps it had left. Judged against the reserve its set asked, a floor (#45). */
  readonly reserve?: number | null
  /** Warm-ups are excluded from progression entirely. See docs/adr/0012-progression-rules.md. */
  readonly isWarmup?: boolean
}

/** The attempts belonging to a single past session, in set order. */
export type SessionAttempts = readonly SetAttempt[]
