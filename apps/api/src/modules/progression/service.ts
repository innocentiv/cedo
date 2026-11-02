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
 * Evaluates every entry in a workout against its logged history: loaded here, evaluated by the
 * pure `suggest` in ./evaluate.ts, whose maths is `progress` from `@cedo/contract`. The
 * `workout_progression` MCP tool renders this answer. See docs/adr/0012-progression-rules.md.
 *
 * Deliberately batched: one query for the entries, one for their prescribed sets, one for the
 * caller's logs across all of them. A per-entry history query would be an N+1 that grows with the
 * size of the plan.
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

  const loaded = await loadEntries(caller, workoutId, null, null)
  if (loaded === null) return []
  const loadFor = await loadsOf(caller.userId, caller.weightUnit)
  return suggest(loaded.entries, loaded.prescribed, loaded.logs, loadFor)
}
