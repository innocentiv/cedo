import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { ExerciseHistory, ExerciseHistoryQuery } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import { exercises, setLogs, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Per-exercise history, newest session first. One indexed read on
 * `set_logs_exercise_time_idx` plus the join — this is the shape a progress chart will consume
 * later without a schema change. See docs/03-domain-model.md.
 */
export async function history(
  caller: Caller,
  exerciseId: string,
  query: ExerciseHistoryQuery,
): Promise<ExerciseHistory> {
  const [exercise] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(visible(exercises, caller), eq(exercises.id, exerciseId)))
    .limit(1)
  if (exercise === undefined) throw notFound('exercise')

  const conditions = [eq(setLogs.exerciseId, exerciseId), eq(workoutSessions.userId, caller.userId)]
  if (query.since !== undefined)
    conditions.push(sql`${workoutSessions.startedAt} >= ${query.since}`)

  const rows = await db
    .select({
      sessionId: setLogs.sessionId,
      performedAt: workoutSessions.startedAt,
      setIndex: setLogs.setIndex,
      isWarmup: setLogs.isWarmup,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      rpe: setLogs.rpe,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(and(...conditions))
    .orderBy(desc(workoutSessions.startedAt), asc(setLogs.setIndex))

  return { exerciseId, sessions: groupIntoSessions(rows).slice(0, query.limit) }
}

type HistoryRow = {
  sessionId: string
  performedAt: Date
  setIndex: number
  isWarmup: boolean
  weightG: number | null
  reps: number | null
  rpe: number | null
  durationS: number | null
  distanceMm: number | null
}

function groupIntoSessions(rows: readonly HistoryRow[]): ExerciseHistory['sessions'] {
  const bySession = new Map<string, ExerciseHistory['sessions'][number]>()
  for (const row of rows) {
    const existing = bySession.get(row.sessionId) ?? {
      sessionId: row.sessionId,
      performedAt: row.performedAt.toISOString(),
      sets: [],
    }
    existing.sets.push({
      setIndex: row.setIndex,
      weightG: row.weightG,
      reps: row.reps,
      rpe: row.rpe,
      durationS: row.durationS,
      distanceMm: row.distanceMm,
      isWarmup: row.isWarmup,
    })
    bySession.set(row.sessionId, existing)
  }
  return [...bySession.values()]
}
