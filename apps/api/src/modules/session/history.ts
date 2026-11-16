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
import type { Training } from '../coaching/training.ts'
import { setsOf } from './sets-of.ts'

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
  training: Training,
  exerciseId: string,
  query: ExerciseHistoryQuery,
): Promise<ExerciseHistory> {
  const tracking = await visibleTracking(training.reader, exerciseId)
  const recentSessions = recentSessionsOf(training, exerciseId, query)

  /**
   * The sets of those sessions, read from `set_logs` itself, not `setsOf`: the sessions are already
   * the training's, picked above, and saying whose again made the planner read every one of the
   * athlete's sessions to hash-join the twenty — where this looks each of them up by id.
   */
  const rows = await db
    .select({
      sessionId: setLogs.sessionId,
      performedAt: workoutSessions.startedAt,
      setIndex: setLogs.setIndex,
      isWarmup: setLogs.isWarmup,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      reserve: setLogs.reserve,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .innerJoin(recentSessions, eq(recentSessions.id, setLogs.sessionId))
    .where(eq(setLogs.exerciseId, exerciseId))
    // In the order performed. Not by number alone: a number counts within its SERIES, so two
    // series of one exercise in a session — two plan entries, or planned and extra sets — share
    // numbers, and ordered by number they interleaved arbitrarily.
    .orderBy(desc(workoutSessions.startedAt), asc(setLogs.loggedAt), asc(setLogs.setIndex))

  return { exerciseId, tracking, ...withStall(groupIntoSessions(rows), tracking) }
}

/**
 * The training's latest sessions that logged the exercise, newest first, as a subquery: the session
 * cap is applied in SQL, not by slicing afterwards. Reading every log for the exercise and keeping
 * the newest twenty sessions transferred hundreds of rows to return a handful — two years of a main
 * lift is easily a thousand. This picks the session ids first, which `set_logs_exercise_time_idx`
 * serves directly.
 */
function recentSessionsOf(training: Training, exerciseId: string, query: ExerciseHistoryQuery) {
  const sets = setsOf(training)
  const conditions = [eq(sets.exerciseId, exerciseId)]
  if (query.since !== undefined) conditions.push(sql`${sets.startedAt} >= ${query.since}`)
  return db
    .selectDistinct({ id: sets.sessionId, startedAt: sets.startedAt })
    .from(sets)
    .where(and(...conditions))
    .orderBy(desc(sets.startedAt))
    .limit(query.limit)
    .as('recent')
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
  reserve: number | null
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
      reserve: row.reserve,
      durationS: row.durationS,
      distanceMm: row.distanceMm,
      isWarmup: row.isWarmup,
    })
    bySession.set(row.sessionId, existing)
  }
  return [...bySession.values()]
}
