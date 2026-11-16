import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { LoggedEffort } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { groupBy } from '../../lib/keyset.ts'
import type { Caller } from '../../plugins/auth.ts'
import { own } from '../coaching/training.ts'
import { setsOf } from '../session/sets-of.ts'

/**
 * Each exercise's working sets in the caller's latest session before `before` that logged it — in
 * any plan or none — in the order they were logged. One query for every exercise: ranked per
 * exercise in SQL, and the latest kept.
 */
export async function lastTimes(
  caller: Caller,
  exerciseIds: readonly string[],
  before: Date,
): Promise<Map<string, LoggedEffort[]>> {
  const sets = setsOf(own(caller))
  const ranked = db
    .select({
      exerciseId: sets.exerciseId,
      reps: sets.reps,
      weightG: sets.weightG,
      durationS: sets.durationS,
      distanceMm: sets.distanceMm,
      loggedAt: sets.loggedAt,
      setIndex: sets.setIndex,
      rank: sql<number>`dense_rank() over (partition by ${sets.exerciseId} order by ${sets.startedAt} desc, ${sets.sessionId} desc)`.as(
        'rank',
      ),
    })
    .from(sets)
    .where(
      and(
        inArray(sets.exerciseId, [...exerciseIds]),
        lt(sets.startedAt, before),
        eq(sets.isWarmup, false),
      ),
    )
    .as('last_ranked')

  const rows = await db
    .select({
      exerciseId: ranked.exerciseId,
      reps: ranked.reps,
      weightG: ranked.weightG,
      durationS: ranked.durationS,
      distanceMm: ranked.distanceMm,
    })
    .from(ranked)
    .where(sql`${ranked.rank} = 1`)
    // Ties broken as exercise history breaks them (`session/history.ts`), so the order is fixed.
    .orderBy(asc(ranked.loggedAt), asc(ranked.setIndex))

  return groupBy(
    rows,
    (r) => r.exerciseId,
    ({ reps, weightG, durationS, distanceMm }) => ({ reps, weightG, durationS, distanceMm }),
  )
}
