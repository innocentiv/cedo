import { eq } from 'drizzle-orm'
import type { ProgressionSuggestion } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visibleWorkouts } from '../../db/visible.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { loadEntries } from './entries.ts'
import { suggest } from './evaluate.ts'

/**
 * Every entry's target in a workout, as the caller's steps left it (ADR-0026): loaded here, read by
 * the pure `suggest` in ./evaluate.ts. The `workout_progression` MCP tool renders this answer.
 *
 * Deliberately batched: one query for the entries, one for their prescribed sets, one for the
 * caller's latest step on all of them. A per-entry query would be an N+1 that grows with the plan.
 */
export async function suggestForWorkout(
  caller: Caller,
  workoutId: string,
): Promise<ProgressionSuggestion[]> {
  const workouts = visibleWorkouts(caller)
  const [workout] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(eq(workouts.id, workoutId))
    .limit(1)
  if (workout === undefined) throw notFound('workout')

  const loaded = await loadEntries(caller, workoutId, null)
  if (loaded === null) return []
  const loadFor = await loadsOf(caller.userId, caller.weightUnit)
  return suggest(loaded.entries, loaded.prescribed, loaded.steps, loadFor)
}

/**
 * Progression's service, as other modules reach it: a person sets a target by hand, and the
 * session module takes and re-takes steps — always through here (docs/02-conventions.md).
 */
export { setTargetByHand } from './by-hand.ts'
export { type StepScope, retakeSteps } from './write-steps.ts'
