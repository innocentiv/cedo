import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { EntryTarget, LoggedEffort } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import { groupBy } from '../../lib/keyset.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { targetsFrom } from './evaluate.ts'
import { loadEntries } from './entries.ts'

/**
 * What a session asks of each entry of the day it follows — the logger's pre-fill — and what was
 * done last time. See `EntryTarget`.
 *
 * The caller's target as their steps left it (ADR-0026). A session takes its step only when it is
 * finished, so its own sets never move what it asks mid-session. A session following no day, or a
 * day out of the caller's reach, asks nothing — there is nothing to offer.
 */
export async function targetsForSession(caller: Caller, sessionId: string): Promise<EntryTarget[]> {
  const [session] = await db
    .select({
      workoutId: workoutSessions.workoutId,
      dayId: workoutSessions.dayId,
      startedAt: workoutSessions.startedAt,
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, caller.userId), eq(workoutSessions.id, sessionId)))
    .limit(1)
  if (session === undefined) throw notFound('session')
  if (session.workoutId === null || session.dayId === null) return []

  const loaded = await loadEntries(caller, session.workoutId, session.dayId)
  if (loaded === null) return []
  const exerciseIds = [...new Set(loaded.entries.map((e) => e.exerciseId))]
  const [last, loadFor] = await Promise.all([
    lastTimes(caller, exerciseIds, session.startedAt),
    loadsOf(caller.userId, caller.weightUnit),
  ])
  return targetsFrom(loaded.entries, loaded.prescribed, loaded.steps, loadFor, last)
}

/**
 * Each exercise's working sets in the caller's latest session before `before` that logged it — in
 * any plan or none — in the order they were logged. One query for every exercise: ranked per
 * exercise in SQL, as `loadLogs` is per entry.
 */
async function lastTimes(
  caller: Caller,
  exerciseIds: readonly string[],
  before: Date,
): Promise<Map<string, LoggedEffort[]>> {
  const ranked = db
    .select({
      exerciseId: setLogs.exerciseId,
      reps: setLogs.reps,
      weightG: setLogs.weightG,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
      loggedAt: setLogs.loggedAt,
      setIndex: setLogs.setIndex,
      rank: sql<number>`dense_rank() over (partition by ${setLogs.exerciseId} order by ${workoutSessions.startedAt} desc, ${workoutSessions.id} desc)`.as(
        'rank',
      ),
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(
      and(
        eq(workoutSessions.userId, caller.userId),
        inArray(setLogs.exerciseId, [...exerciseIds]),
        lt(workoutSessions.startedAt, before),
        eq(setLogs.isWarmup, false),
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
