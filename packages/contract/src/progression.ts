import { z } from 'zod'
import {
  SHORT_OF_TARGETS,
  judgeDistance,
  judgeDuration,
  judgeReps,
  judgeRun,
  working,
} from './clears.ts'
import { TrackingMode } from './exercise.ts'
import { TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'
import { Rpe } from './rpe.ts'
import { unhandledKind } from './stored-rule.ts'

/**
 * How a set's targets advance over time. Stored as JSONB on `workout_entries`, so adding a rule
 * kind means extending this union and `progress` — never a migration.
 * See docs/adr/0012-progression-rules.md.
 */

export const Progression = z.discriminatedUnion('kind', [
  /** Targets never change automatically; the user or the AI sets them explicitly. */
  z.object({ kind: z.literal('none') }),

  /**
   * Add weight once the target has been met for `afterSuccesses` consecutive sessions.
   * Classic linear periodisation — the right default for novices.
   */
  z.object({
    kind: z.literal('linear'),
    incrementG: z.int().positive().max(50_000),
    afterSuccesses: z.int().min(1).max(10).default(1),
  }),

  /**
   * Work reps up through a range at a fixed weight; on clearing the top of the range, add weight
   * and drop back to the bottom. The standard hypertrophy scheme.
   */
  z.object({
    kind: z.literal('double'),
    repRange: z.tuple([z.int().min(1).max(100), z.int().min(1).max(100)]),
    incrementG: z.int().positive().max(50_000),
  }),

  /**
   * Hold for longer. For `duration` exercises — planks, dead hangs, loaded carries — where
   * progression is time under load rather than weight on the bar.
   */
  z.object({
    kind: z.literal('linear_duration'),
    incrementS: z.int().positive().max(3600),
    afterSuccesses: z.int().min(1).max(10).default(1),
  }),

  /**
   * Go further at the same pace. For `distance_duration` exercises — runs, rows — where the time
   * grows with the distance, so a volume step is never a pace jump (#14). Going faster stays a
   * deliberate change: a shorter time would break advance-or-hold.
   */
  z.object({
    kind: z.literal('linear_distance'),
    incrementMm: z.int().positive().max(10_000_000),
    afterSuccesses: z.int().min(1).max(10).default(1),
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
  rpe: Rpe.nullable(),
  durationS: TargetDurationS.nullable(),
  distanceMm: TargetDistanceMm.nullable(),
})
export type SetTarget = z.output<typeof SetTarget>

/** A set asked for nothing in particular: a first set of an exercise with no plan, no history. */
export const NO_TARGET: SetTarget = {
  reps: null,
  weightG: null,
  rpe: null,
  durationS: null,
  distanceMm: null,
}

/**
 * Why a rule held a prescription (#45) — the glossary's "Held": a session short of its `targets`,
 * or one ground out past its RPE (`effort`), with the hardest working set's RPE as it was rated.
 * Null when the rule advanced, or had nothing to hold it for: no history, no rule, nothing left to
 * add, or a ceiling. Not a timed set, which the glossary also calls a hold.
 */
export const Held = z.discriminatedUnion('reason', [
  z.object({ reason: z.literal('targets') }),
  z.object({ reason: z.literal('effort'), rpe: Rpe }),
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
  /** How hard it was. Judged against a prescribed RPE, its ceiling (#45). */
  readonly rpe?: number | null
  /** Warm-ups are excluded from progression entirely. See docs/adr/0012-progression-rules.md. */
  readonly isWarmup?: boolean
}

/** The attempts belonging to a single past session, in set order. */
export type SessionAttempts = readonly SetAttempt[]

export interface ProgressionInput {
  readonly rule: Progression
  /** The entry's current prescription. One weight per entry — sets never diverge. */
  readonly target: SetTarget
  /** How many WORKING sets the entry prescribes. Warm-ups do not count. */
  readonly workingSets: number
  /**
   * Each working set's own prescribed RPE, in set order (ADR-0026: effort ramps across sets, and
   * each set is judged against its own). Omitted, every working set asks the target's.
   */
  readonly ceilings?: readonly (number | null)[]
  /** Past sessions for this entry, MOST RECENT FIRST. */
  readonly sessions: readonly SessionAttempts[]
}

/**
 * Compute the next prescription, and why it held when it did. Pure, total, and deterministic — the
 * single implementation, called by the API's progression service, whose answers the
 * `workout_progression` MCP tool and the logger's pre-fill (`EntryTarget`) both render.
 *
 * It ADVANCES OR HOLDS, never decreases. Deloading is a judgement call needing context this
 * function does not have (illness, a bad week, form breakdown), so it stays with the user or the
 * AI, acting through `workout_save_plan`.
 *
 * At a target's ceiling it holds: a suggestion past what a target may be would be refused by the
 * API's own response schema, failing the plan's whole progression and the logger's pre-fill.
 */
export function progress(input: ProgressionInput): Progressed {
  const next = advance(input)
  return SetTarget.safeParse(next.target).success ? next : unheld(input.target)
}

/** What `progress` answers: the next prescription, and why it held, if something held it. */
export interface Progressed {
  readonly target: SetTarget
  readonly held: Held | null
}

/** A prescription nothing held: advanced, or with nothing to hold it for. */
const unheld = (target: SetTarget): Progressed => ({ target, held: null })

function advance(input: ProgressionInput): Progressed {
  const { rule } = input
  switch (rule.kind) {
    case 'none':
      return unheld(input.target)
    case 'linear':
      return advanceWeight(rule, input)
    case 'linear_duration':
      return advanceDuration(rule, input)
    case 'linear_distance':
      return advanceDistance(rule, input)
    case 'double':
      return advanceDouble(rule, input)
    default:
      return unhandledKind(rule)
  }
}

type RuleOf<K extends Progression['kind']> = Extract<Progression, { kind: K }>

/** The RPE each working set asks, in set order: its own, or — not given — the target's. */
const ceilingsOf = ({ target, workingSets, ceilings }: ProgressionInput): (number | null)[] =>
  Array.from({ length: workingSets }, (_, i) =>
    ceilings === undefined ? target.rpe : (ceilings[i] ?? null),
  )

function advanceWeight(rule: RuleOf<'linear'>, input: ProgressionInput): Progressed {
  const { target, sessions } = input
  const ceilings = ceilingsOf(input)
  const run = judgeRun(rule.afterSuccesses, sessions, (s) =>
    judgeReps(s, target.reps, target, ceilings),
  )
  if (run !== 'cleared') return { target, held: run }
  if (target.weightG === null) return unheld(target)
  return unheld({ ...target, weightG: target.weightG + rule.incrementG })
}

function advanceDuration(
  rule: RuleOf<'linear_duration'>,
  { target, workingSets, sessions }: ProgressionInput,
): Progressed {
  const run = judgeRun(rule.afterSuccesses, sessions, (s) => judgeDuration(s, target, workingSets))
  if (run !== 'cleared') return { target, held: run }
  if (target.durationS === null) return unheld(target)
  return unheld({ ...target, durationS: target.durationS + rule.incrementS })
}

function advanceDistance(
  rule: RuleOf<'linear_distance'>,
  { target, workingSets, sessions }: ProgressionInput,
): Progressed {
  const run = judgeRun(rule.afterSuccesses, sessions, (s) => judgeDistance(s, target, workingSets))
  if (run !== 'cleared') return { target, held: run }
  if (target.distanceMm === null) return unheld(target)
  const distanceMm = target.distanceMm + rule.incrementMm
  // The prescribed pace, kept: the time grows in proportion, to whole seconds rounded up — rounded
  // down, it would ask for a hair faster than the pace.
  const durationS =
    target.durationS === null
      ? null
      : Math.ceil((target.durationS * distanceMm) / target.distanceMm)
  return unheld({ ...target, distanceMm, durationS })
}

function advanceDouble(rule: RuleOf<'double'>, input: ProgressionInput): Progressed {
  const { target, sessions } = input
  const latest = sessions[0]
  if (latest === undefined) return unheld(target)
  const last = working(latest)
  if (last === null) return { target, held: SHORT_OF_TARGETS }

  const [minReps, maxReps] = rule.repRange
  const currentReps = target.reps ?? minReps
  const atTop = currentReps >= maxReps

  // Every working set asked for the top of the range when at it, else the current target.
  const goal = atTop ? maxReps : currentReps
  const verdict = judgeReps(last, goal, target, ceilingsOf(input))
  if (verdict !== 'cleared') return { target, held: verdict }

  // Cleared the top of the range: add weight, restart at the bottom.
  if (atTop) {
    if (target.weightG === null) return unheld(target)
    return unheld({ ...target, reps: minReps, weightG: target.weightG + rule.incrementG })
  }

  // Met the current target: climb one rep.
  return unheld({ ...target, reps: currentReps + 1 })
}
