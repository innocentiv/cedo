import { and, asc, desc, eq, sql } from 'drizzle-orm'
import {
  type ExerciseHistory,
  type ExerciseHistoryQuery,
  LoggedEffort,
  type TrackingMode,
  stallOf,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises } from '../../db/visible.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Per-exercise history, newest session first. One indexed read on
 * `set_logs_exercise_time_idx` plus the join — this is the shape a progress chart will consume
 * later without a schema change. See docs/03-domain-model.md.
 */
async function visibleTracking(caller: Caller, exerciseId: string): Promise<TrackingMode> {
  const exercises = visibleExercises(caller)
  const [exercise] = await db
    .select({ tracking: exercises.tracking })
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1)
  if (exercise === undefined) throw notFound('exercise')
  return exercise.tracking
}

export async function history(
  caller: Caller,
  exerciseId: string,
  query: ExerciseHistoryQuery,
): Promise<ExerciseHistory> {
  const tracking = await visibleTracking(caller, exerciseId)

  const conditions = [eq(setLogs.exerciseId, exerciseId), eq(workoutSessions.userId, caller.userId)]
  if (query.since !== undefined)
    conditions.push(sql`${workoutSessions.startedAt} >= ${query.since}`)

  /**
   * The session cap is applied in SQL, not by slicing afterwards.
   *
   * Reading every log for the exercise and keeping the newest twenty sessions transferred hundreds
   * of rows to return a handful — two years of a main lift is easily a thousand. The subquery picks
   * the session ids first, which `set_logs_exercise_time_idx` serves directly.
   */
  const recentSessions = db
    .selectDistinct({ id: workoutSessions.id, startedAt: workoutSessions.startedAt })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(and(...conditions))
    .orderBy(desc(workoutSessions.startedAt))
    .limit(query.limit)
    .as('recent')

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
    .innerJoin(recentSessions, eq(sql`recent.id`, setLogs.sessionId))
    .where(eq(setLogs.exerciseId, exerciseId))
    // In the order performed. Not by number alone: a number counts within its SERIES, so two
    // series of one exercise in a session — two plan entries, or planned and extra sets — share
    // numbers, and ordered by number they interleaved arbitrarily.
    .orderBy(desc(workoutSessions.startedAt), asc(setLogs.loggedAt), asc(setLogs.setIndex))

  return { exerciseId, tracking, ...withStall(groupIntoSessions(rows), tracking) }
}

/**
 * The sessions, and their stall — the contract's `stallOf`, the rule `training_review` applies,
 * over the latest `STALL_DEPTH` of them as it does. A read asking for fewer than three sessions,
 * or none before a `since`, cannot show one.
 */
function withStall(
  sessions: ExerciseHistory['sessions'],
  tracking: ExerciseHistory['tracking'],
): Pick<ExerciseHistory, 'sessions' | 'stalled'> {
  const working = sessions.map((s) => s.sets.filter((set) => !set.isWarmup))
  const stall = stallOf(working, tracking)
  if (stall === null) return { sessions, stalled: null }
  // A logged set's measures, no more: what the badge says it is stuck at.
  return {
    sessions,
    stalled: { sessions: stall.sessions, effort: LoggedEffort.parse(stall.effort) },
  }
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
