import { type SQL, and, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Effort } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'

/**
 * What each exercise's earlier working sets could be beaten by — the candidates `personalBestsIn`
 * judges a session's sets against (#24). Not every set: the best weight at each rep count, and the
 * longest and shortest time at each distance, which hold every set that could be a best by any
 * mode's rule — a lift's estimated max from its heaviest set at a rep count, a hold's longest time,
 * a distance's quickest — in one grouped read, however long the history. Of sessions started before
 * `before`, so a session read later, or by a coach, is judged as it was when it was done.
 */
export async function earlierBests(
  /** The reader's `sessionsOf(training)`, so whose sessions these are is said in one place. */
  whose: SQL,
  before: Date,
  exerciseIds: readonly string[],
): Promise<Map<string, Effort[]>> {
  if (exerciseIds.length === 0) return new Map()
  const rows = await db
    .select({
      exerciseId: setLogs.exerciseId,
      reps: setLogs.reps,
      distanceMm: setLogs.distanceMm,
      weightG: sql<number | null>`max(${setLogs.weightG})`,
      longest: sql<number | null>`max(${setLogs.durationS})`,
      shortest: sql<number | null>`min(${setLogs.durationS})`,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(
      and(
        whose,
        lt(workoutSessions.startedAt, before),
        inArray(setLogs.exerciseId, [...exerciseIds]),
        eq(setLogs.isWarmup, false),
      ),
    )
    .groupBy(setLogs.exerciseId, setLogs.reps, setLogs.distanceMm)

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
