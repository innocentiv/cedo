import { DIMENSION_FIELDS, type Effort, type LoggedExercise, topSet } from '@cedo/contract'
import type { TrainingReview } from './service.ts'

/**
 * Pure: each exercise's working sets, session by session, in; which have stalled out. No database,
 * so the rule is unit-testable — it was a HAVING clause, fixed three times (grouped by name; a NULL
 * aggregate read as "0kg"; distance left out of the effort compared). See GLOSSARY.md, "Stalled".
 */

/** One working set the caller logged, with the exercise and session it belongs to. */
export interface WorkingSet {
  readonly exerciseId: string
  readonly exercise: LoggedExercise
  readonly sessionId: string
  readonly effort: Effort
}

/** A stall is at least this many sessions running with the same top set. */
const AT_LEAST_SESSIONS = 3

/**
 * The most recent sessions of an exercise read — and so the longest run a stall reports. Capped in
 * SQL by the loader, where the rows are selected, so the read does not grow with history.
 */
export const STALL_DEPTH = 10

/** The effort as a value two sets can be compared by: every dimension, so none can be missed. */
const keyOf = (effort: Effort): string =>
  JSON.stringify(Object.values(DIMENSION_FIELDS).map((field) => effort[field.key]))

/**
 * Stalled: the exercise's latest sessions, three or more running, share one top set — its best
 * working set, as its tracking mode ranks efforts (`topSet`). The top set, not every set: a rep
 * missed on a back-off set is not progress, and used to hide the stall. Judged on what was LOGGED,
 * not on a prescription — a plan can say anything — so an exercise logged without one can stall
 * too. `sets` arrive newest session first, at most `STALL_DEPTH` sessions of each exercise.
 */
export function stalledOf(sets: readonly WorkingSet[]): TrainingReview['stalled'] {
  const byExercise = new Map<
    string,
    { exercise: LoggedExercise; sessions: Map<string, Effort[]> }
  >()
  for (const set of sets) {
    const seen = byExercise.get(set.exerciseId) ?? {
      exercise: set.exercise,
      sessions: new Map<string, Effort[]>(),
    }
    seen.sessions.set(set.sessionId, [...(seen.sessions.get(set.sessionId) ?? []), set.effort])
    byExercise.set(set.exerciseId, seen)
  }
  return [...byExercise.values()]
    .flatMap(({ exercise, sessions }) => {
      const tops = [...sessions.values()].map((efforts) => topSet(efforts, exercise.tracking))
      const [latest] = tops
      if (latest === undefined) return []
      const run = tops.findIndex((top) => top === undefined || keyOf(top) !== keyOf(latest))
      const sessionsRunning = run === -1 ? tops.length : run
      return sessionsRunning >= AT_LEAST_SESSIONS
        ? [{ exercise, sessions: sessionsRunning, effort: latest }]
        : []
    })
    .toSorted((a, b) => a.exercise.name.localeCompare(b.exercise.name))
}
