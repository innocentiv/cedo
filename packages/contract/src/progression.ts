import { z } from 'zod'
import { Rpe, TargetDistanceMm, TargetDurationS, TargetReps, TargetWeightG } from './measurement.ts'

/**
 * How a set's targets advance over time. Stored as JSONB on `workout_entries`, so adding a rule
 * kind means extending this union and `nextTarget` — never a migration.
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
])
export type Progression = z.output<typeof Progression>

export const PROGRESSION_KINDS = ['none', 'linear', 'double', 'linear_duration'] as const

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

/**
 * What `nextTarget` proposes for one workout entry, alongside what it proposes to change from.
 * Returned by `GET /workouts/:id/progression` and by the `workout_progression` MCP tool — the AI's
 * entry point for "evaluate my progression and set next week's numbers".
 */
export const ProgressionSuggestion = z.object({
  entryId: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  rule: Progression,
  current: SetTarget,
  suggested: SetTarget,
  /** False when the rule held rather than advanced — the UI shows that as a stall. */
  changed: z.boolean(),
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
  /** Past sessions for this entry, MOST RECENT FIRST. */
  readonly sessions: readonly SessionAttempts[]
}

/**
 * Compute the next prescription. Pure, total, and deterministic — the single implementation, called
 * by the API's progression service, whose answer the `workout_progression` MCP tool and the logging
 * screen both render.
 *
 * It ADVANCES OR HOLDS, never decreases. Deloading is a judgement call needing context this
 * function does not have (illness, a bad week, form breakdown), so it stays with the user or the
 * AI, acting through `workout_update_plan`.
 */
export function nextTarget(input: ProgressionInput): SetTarget {
  const { rule } = input
  switch (rule.kind) {
    case 'none':
      return input.target
    case 'linear':
      return advanceWeight(rule, input)
    case 'linear_duration':
      return advanceDuration(rule, input)
    case 'double':
      return advanceDouble(rule, input)
    default:
      return unreachable(rule)
  }
}

type RuleOf<K extends Progression['kind']> = Extract<Progression, { kind: K }>

function advanceWeight(
  rule: RuleOf<'linear'>,
  { target, workingSets, sessions }: ProgressionInput,
): SetTarget {
  const clean = succeededFor(rule.afterSuccesses, sessions, (s) =>
    clearsReps(s, target.reps, target, workingSets),
  )
  if (!clean || target.weightG === null) return target
  return { ...target, weightG: target.weightG + rule.incrementG }
}

function advanceDuration(
  rule: RuleOf<'linear_duration'>,
  { target, workingSets, sessions }: ProgressionInput,
): SetTarget {
  const clean = succeededFor(rule.afterSuccesses, sessions, (s) =>
    clearsDuration(s, target.durationS, workingSets),
  )
  if (!clean || target.durationS === null) return target
  return { ...target, durationS: target.durationS + rule.incrementS }
}

function advanceDouble(
  rule: RuleOf<'double'>,
  { target, workingSets, sessions }: ProgressionInput,
): SetTarget {
  const last = working(sessions[0])
  if (last === null) return target

  const [minReps, maxReps] = normaliseRange(rule.repRange)
  const currentReps = target.reps ?? minReps

  // Cleared the top of the range on every working set: add weight, restart at the bottom.
  if (currentReps >= maxReps && clearsReps(last, maxReps, target, workingSets)) {
    if (target.weightG === null) return target
    return { ...target, reps: minReps, weightG: target.weightG + rule.incrementG }
  }

  // Met the current target on every working set: climb one rep.
  if (currentReps < maxReps && clearsReps(last, currentReps, target, workingSets)) {
    return { ...target, reps: currentReps + 1 }
  }

  return target
}

/** The most recent `count` sessions must all satisfy `predicate`. */
function succeededFor(
  count: number,
  sessions: readonly SessionAttempts[],
  predicate: (session: SessionAttempts) => boolean,
): boolean {
  if (sessions.length < count) return false
  return sessions.slice(0, count).every((session) => {
    const sets = working(session)
    return sets !== null && predicate(sets)
  })
}

/** Drop warm-ups. Returns null when the session recorded nothing that counts. */
function working(session: SessionAttempts | undefined): SessionAttempts | null {
  if (session === undefined) return null
  const sets = session.filter((s) => s.isWarmup !== true)
  return sets.length === 0 ? null : sets
}

/**
 * A session clears a rep goal only when EVERY prescribed working set reached it at no less than the
 * target weight. A missing set, an unrecorded rep count, or a lighter load all mean "not cleared".
 */
function clearsReps(
  session: SessionAttempts,
  repGoal: number | null,
  target: SetTarget,
  workingSets: number,
): boolean {
  if (repGoal === null) return false
  if (session.length < workingSets) return false

  return session.slice(0, workingSets).every((attempt) => {
    const reps = attempt.reps ?? null
    if (reps === null || reps < repGoal) return false
    if (target.weightG === null) return true
    const weight = attempt.weightG ?? null
    return weight !== null && weight >= target.weightG
  })
}

/** Every prescribed working set must have been held for at least the target duration. */
function clearsDuration(
  session: SessionAttempts,
  durationGoal: number | null,
  workingSets: number,
): boolean {
  if (durationGoal === null) return false
  if (session.length < workingSets) return false

  return session.slice(0, workingSets).every((attempt) => {
    const held = attempt.durationS ?? null
    return held !== null && held >= durationGoal
  })
}

/** Tolerate a range stored the wrong way round rather than producing nonsense. */
function normaliseRange(range: readonly [number, number]): [number, number] {
  const [a, b] = range
  return a <= b ? [a, b] : [b, a]
}

/**
 * Guards a union that arrives from outside the type system — `progression` is stored as JSONB, so
 * an unknown kind really is reachable if a row is edited by hand or written by an older version.
 */
function unreachable(value: never): never {
  throw new Error(`Unhandled progression kind: ${JSON.stringify(value)}`)
}

/** Human-readable rule summary. Lives here so screens never format domain concepts themselves. */
export function describeProgression(
  rule: Progression,
  formatIncrement: (grams: number) => string,
): string {
  switch (rule.kind) {
    case 'none':
      return 'Manual'
    case 'linear':
      return rule.afterSuccesses === 1
        ? `Linear, +${formatIncrement(rule.incrementG)}`
        : `Linear, +${formatIncrement(rule.incrementG)} after ${rule.afterSuccesses} clean sessions`
    case 'linear_duration':
      return `Linear, +${rule.incrementS}s`
    case 'double': {
      const [min, max] = normaliseRange(rule.repRange)
      return `Double ${min}–${max}, +${formatIncrement(rule.incrementG)}`
    }
    default:
      return unreachable(rule)
  }
}
