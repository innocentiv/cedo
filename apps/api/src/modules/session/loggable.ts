import { inArray } from 'drizzle-orm'
import { type LogSetInput, type LoggedExercise, weightAllowed } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visibleExercises } from '../../db/visible.ts'
import { invalid, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * What a set may reference, checked for a whole batch in one query per kind — `logSet` passes one
 * set, `logWhole` a whole session.
 *
 * - Every exercise must be VISIBLE, or a log could reference one the caller cannot see.
 * - An entry must be part of the plan the session is FOR, and prescribe the exercise being logged.
 *   Progression reads logs by entry, so visibility alone let a set from plan A's session count
 *   toward plan B; and existence alone, before that, let anyone attach a log to a guessed id.
 */
/**
 * A negative weight is assistance, which only a bodyweight movement takes (#19) — on the field, as
 * any other invalid value is.
 */
export const assistanceRefused = () =>
  invalid('Only a bodyweight movement can be assisted: a negative weight is assistance', [
    { path: 'weightG', message: 'Cannot be negative for this exercise' },
  ])

export async function assertLoggable(
  caller: Caller,
  workoutId: string | null,
  sets: readonly LogSetInput[],
): Promise<ReadonlyMap<string, LoggedExercise>> {
  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))]
  const exercises = visibleExercises(caller)
  const seen = await db
    .select({ id: exercises.id, name: exercises.name, tracking: exercises.tracking })
    .from(exercises)
    .where(inArray(exercises.id, exerciseIds))
  // Returned, not just checked: what the caller may log against is what the log then names.
  const visible = new Map(seen.map((e) => [e.id, { name: e.name, tracking: e.tracking }]))
  const hidden = exerciseIds.find((id) => !visible.has(id))
  if (hidden !== undefined) throw notFound('exercise')
  for (const set of sets) {
    const tracking = visible.get(set.exerciseId)?.tracking
    if (tracking !== undefined && !weightAllowed(set.weightG, tracking)) throw assistanceRefused()
  }

  const entryIds = [...new Set(sets.flatMap((s) => (s.entryId === null ? [] : [s.entryId])))]
  if (entryIds.length === 0) return visible
  if (workoutId === null) throw invalid('An ad-hoc session has no plan entries to log against')

  const plan = planEntries(caller, workoutId)
  const entries = await db
    .select({ id: plan.id, exerciseId: plan.exerciseId })
    .from(plan)
    .where(inArray(plan.id, entryIds))
  const exerciseOf = new Map(entries.map((e) => [e.id, e.exerciseId]))
  for (const set of sets) {
    if (set.entryId === null) continue
    const prescribed = exerciseOf.get(set.entryId)
    if (prescribed === undefined) throw notFound('entry')
    if (prescribed !== set.exerciseId) throw invalid('That entry prescribes a different exercise')
  }
  return visible
}
