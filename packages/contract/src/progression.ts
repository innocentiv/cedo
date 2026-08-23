import { z } from 'zod'

/**
 * How a set's targets advance over time. Stored as JSONB on `workout_entries`, so adding a rule
 * kind means extending this union and `nextTarget` — never a migration. See docs/03-domain-model.md.
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
])
export type Progression = z.output<typeof Progression>

export const PROGRESSION_KINDS = ['none', 'linear', 'double'] as const

export const NO_PROGRESSION: Progression = { kind: 'none' }

/** What a set prescribes. Nulls mean "not prescribed" — e.g. bodyweight work has no target weight. */
export const SetTarget = z.object({
  reps: z.int().positive().max(1000).nullable(),
  weightG: z.int().nonnegative().nullable(),
  rpe: z.int().min(1).max(10).nullable(),
})
export type SetTarget = z.output<typeof SetTarget>

/** One logged set. `null` means the field was not recorded. */
export interface SetAttempt {
  readonly weightG: number | null
  readonly reps: number | null
}

/** The attempts belonging to a single past session, in set order. */
export type SessionAttempts = readonly SetAttempt[]

export interface ProgressionInput {
  readonly rule: Progression
  /** The entry's current prescription. One weight per entry — sets never diverge. */
  readonly target: SetTarget
  /** How many sets the entry prescribes. A partially logged session cannot earn a promotion. */
  readonly prescribedSets: number
  /** Past sessions for this entry, MOST RECENT FIRST. */
  readonly sessions: readonly SessionAttempts[]
}

/**
 * Compute the next prescription. Pure, total, and deterministic — the single implementation used
 * by the API, the `progression_suggest` MCP tool and the logging screen.
 *
 * It ADVANCES OR HOLDS, never decreases. Deloading is a judgement call that needs context this
 * function does not have (illness, a bad week, form breakdown), so it stays with the user or the
 * AI, acting through `workout_update_plan`. See docs/adr/0012-progression-rules.md.
 */
export function nextTarget({
  rule,
  target,
  prescribedSets,
  sessions,
}: ProgressionInput): SetTarget {
  switch (rule.kind) {
    case 'none':
      return target

    case 'linear': {
      const required = rule.afterSuccesses
      if (sessions.length < required) return target
      const recent = sessions.slice(0, required)
      const allSucceeded = recent.every((s) => cleared(s, target.reps, target, prescribedSets))
      if (!allSucceeded || target.weightG === null) return target
      return { ...target, weightG: target.weightG + rule.incrementG }
    }

    case 'double': {
      const last = sessions[0]
      if (last === undefined) return target

      const [minReps, maxReps] = normaliseRange(rule.repRange)
      const currentReps = target.reps ?? minReps

      // Cleared the top of the range on every set: add weight, restart at the bottom.
      if (currentReps >= maxReps && cleared(last, maxReps, target, prescribedSets)) {
        if (target.weightG === null) return target
        return { ...target, reps: minReps, weightG: target.weightG + rule.incrementG }
      }

      // Met the current target on every set: climb one rep.
      if (currentReps < maxReps && cleared(last, currentReps, target, prescribedSets)) {
        return { ...target, reps: currentReps + 1 }
      }

      return target
    }

    default:
      return unreachable(rule)
  }
}

/**
 * Guards a union that arrives from outside the type system — `progression` is stored as JSONB, so
 * an unknown kind really is reachable if a row is edited by hand or written by an older version.
 */
function unreachable(value: never): never {
  throw new Error(`Unhandled progression kind: ${JSON.stringify(value)}`)
}

/**
 * A session clears a rep goal only when EVERY prescribed set reached it at no less than the target
 * weight. A missing set, an unrecorded rep count, or a lighter load all mean "not cleared".
 */
function cleared(
  session: SessionAttempts,
  repGoal: number | null,
  target: SetTarget,
  prescribedSets: number,
): boolean {
  if (repGoal === null) return false
  if (session.length < prescribedSets) return false

  return session.slice(0, prescribedSets).every((attempt) => {
    if (attempt.reps === null || attempt.reps < repGoal) return false
    if (target.weightG === null) return true
    return attempt.weightG !== null && attempt.weightG >= target.weightG
  })
}

/** Tolerate a range stored the wrong way round rather than producing nonsense. */
function normaliseRange(range: readonly [number, number]): [number, number] {
  const [a, b] = range
  return a <= b ? [a, b] : [b, a]
}

/** Human-readable rule summary. Lives here so screens never format domain concepts themselves. */
export function describeProgression(
  rule: Progression,
  formatIncrement: (g: number) => string,
): string {
  switch (rule.kind) {
    case 'none':
      return 'Manual'
    case 'linear':
      return rule.afterSuccesses === 1
        ? `Linear, +${formatIncrement(rule.incrementG)}`
        : `Linear, +${formatIncrement(rule.incrementG)} after ${rule.afterSuccesses} clean sessions`
    case 'double': {
      const [min, max] = normaliseRange(rule.repRange)
      return `Double ${min}–${max}, +${formatIncrement(rule.incrementG)}`
    }

    default:
      return unreachable(rule)
  }
}
