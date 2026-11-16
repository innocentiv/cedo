import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Effort } from '@cedo/contract'
import { db } from '../../db/client.ts'
import type { Training } from '../coaching/training.ts'
import { setsOf } from './sets-of.ts'

/**
 * What each exercise's earlier working sets could be beaten by — the candidates `personalBestsIn`
 * judges a session's sets against (#24). Not every set: the best weight at each rep count, and the
 * longest and shortest time at each distance, which hold every set that could be a best by any
 * mode's rule — a lift's estimated max from its heaviest set at a rep count, a hold's longest time,
 * a distance's quickest — in one grouped read, however long the history. Of sessions started before
 * `before`, so a session read later, or by a coach, is judged as it was when it was done.
 */
export async function earlierBests(
  training: Training,
  before: Date,
  exerciseIds: readonly string[],
): Promise<Map<string, Effort[]>> {
  if (exerciseIds.length === 0) return new Map()
  const sets = setsOf(training)
  const rows = await db
    .select({
      exerciseId: sets.exerciseId,
      reps: sets.reps,
      distanceMm: sets.distanceMm,
      weightG: sql<number | null>`max(${sets.weightG})`,
      longest: sql<number | null>`max(${sets.durationS})`,
      shortest: sql<number | null>`min(${sets.durationS})`,
    })
    .from(sets)
    .where(
      and(
        lt(sets.startedAt, before),
        inArray(sets.exerciseId, [...exerciseIds]),
        eq(sets.isWarmup, false),
      ),
    )
    .groupBy(sets.exerciseId, sets.reps, sets.distanceMm)

  const bests = new Map<string, Effort[]>()
  for (const r of rows) {
    const at = { reps: r.reps, weightG: r.weightG, distanceMm: r.distanceMm }
    bests.set(r.exerciseId, [
      ...(bests.get(r.exerciseId) ?? []),
      { ...at, durationS: r.longest },
      { ...at, durationS: r.shortest },
    ])
  }
  return bests
}
