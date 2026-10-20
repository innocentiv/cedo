import { DIMENSION_FIELDS, type Effort, type LoggedExercise } from '@cedo/contract'
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

/** An exercise is judged on at least this many sessions of it. */
const AT_LEAST_SESSIONS = 3

/** The effort as a value two sets can be compared by: every dimension, so none can be missed. */
const keyOf = (effort: Effort): string =>
  JSON.stringify(Object.values(DIMENSION_FIELDS).map((field) => effort[field.key]))

/**
 * Stalled: logged in at least three sessions, every working set the same effort. Judged on what
 * was LOGGED, not on a prescription: a plan can say anything, the logs say what happened.
 */
export function stalledOf(sets: readonly WorkingSet[]): TrainingReview['stalled'] {
  const byExercise = new Map<
    string,
    { exercise: LoggedExercise; sessions: Set<string>; efforts: Map<string, Effort> }
  >()
  for (const set of sets) {
    const seen = byExercise.get(set.exerciseId) ?? {
      exercise: set.exercise,
      sessions: new Set<string>(),
      efforts: new Map<string, Effort>(),
    }
    seen.sessions.add(set.sessionId)
    seen.efforts.set(keyOf(set.effort), set.effort)
    byExercise.set(set.exerciseId, seen)
  }
  return [...byExercise.values()]
    .flatMap(({ exercise, sessions, efforts }) => {
      const [effort] = efforts.values()
      return sessions.size >= AT_LEAST_SESSIONS && efforts.size === 1 && effort !== undefined
        ? [{ exercise, sessions: sessions.size, effort }]
        : []
    })
    .toSorted((a, b) => a.exercise.name.localeCompare(b.exercise.name))
}
