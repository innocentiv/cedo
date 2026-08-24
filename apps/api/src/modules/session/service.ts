import { and, asc, eq } from 'drizzle-orm'
import type {
  LogSetInput,
  SessionStart,
  SessionUpdate,
  SetLog,
  WorkoutSession,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { visible } from '../../db/ownable.ts'
import {
  exercises,
  setLogs,
  workoutDays,
  workoutEntries,
  workoutSessions,
  workouts,
} from '../../db/schema.ts'
import { conflict, invalid, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'

/**
 * Sessions are PERSONAL. They are not `ownable()` — they belong to a `user_id` directly and are
 * never shared, favourited or transferred, so every query here filters on the caller's own id
 * rather than on group membership. See docs/03-domain-model.md.
 */
export const ownedBy = (caller: Caller) => eq(workoutSessions.userId, caller.userId)

export type SessionRow = typeof workoutSessions.$inferSelect
type LogRow = typeof setLogs.$inferSelect

const toLog = (row: LogRow): SetLog => ({
  id: row.id,
  entryId: row.entryId,
  exerciseId: row.exerciseId,
  setIndex: row.setIndex,
  isWarmup: row.isWarmup,
  weightG: row.weightG,
  reps: row.reps,
  rpe: row.rpe,
  durationS: row.durationS,
  distanceMm: row.distanceMm,
  loggedAt: row.loggedAt.toISOString(),
})

const toSession = (row: SessionRow, logs: LogRow[]): WorkoutSession => ({
  id: row.id,
  workoutId: row.workoutId,
  dayId: row.dayId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  notes: row.notes,
  logs: logs.map((l) => toLog(l)),
})

/**
 * `workoutId` and `dayId` are optional: walking into the gym and lifting without a plan uses the
 * same tables and feeds the same history. When they ARE given, both must be visible and the day
 * must belong to the workout — otherwise a session could reference someone else's plan.
 */
export async function start(caller: Caller, input: SessionStart): Promise<WorkoutSession> {
  if (input.dayId !== null && input.workoutId === null) {
    throw invalid('A dayId without a workoutId does not identify a plan')
  }

  if (input.workoutId !== null) {
    const [found] = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(visible(workouts, caller), eq(workouts.id, input.workoutId)))
      .limit(1)
    if (found === undefined) throw notFound('workout')
  }

  if (input.dayId !== null && input.workoutId !== null) {
    const [day] = await db
      .select({ id: workoutDays.id })
      .from(workoutDays)
      .where(and(eq(workoutDays.id, input.dayId), eq(workoutDays.workoutId, input.workoutId)))
      .limit(1)
    if (day === undefined) throw notFound('day')
  }

  const [created] = await db
    .insert(workoutSessions)
    .values({ userId: caller.userId, workoutId: input.workoutId, dayId: input.dayId })
    .returning()
  if (created === undefined) throw new Error('Could not start the session')

  return toSession(created, [])
}

export async function get(caller: Caller, id: string): Promise<WorkoutSession> {
  const [row] = await db
    .select()
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .limit(1)
  if (row === undefined) throw notFound('session')

  const logs = await db
    .select()
    .from(setLogs)
    .where(eq(setLogs.sessionId, id))
    .orderBy(asc(setLogs.loggedAt), asc(setLogs.setIndex))

  return toSession(row, logs)
}

export async function update(
  caller: Caller,
  id: string,
  patch: SessionUpdate,
): Promise<WorkoutSession> {
  const columns = {
    ...(patch.endedAt !== undefined && {
      endedAt: patch.endedAt === null ? null : new Date(patch.endedAt),
    }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
  }

  /**
   * An empty patch is valid input — `SessionUpdate` has only optional fields — but Drizzle throws
   * "No values to set" on `.set({})`, which surfaces as a 500. Exercise and workout updates escape
   * this only because they always touch `updated_at`; `workout_sessions` has no such column.
   */
  if (Object.keys(columns).length === 0) return await get(caller, id)

  const written = await db
    .update(workoutSessions)
    .set(columns)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .returning({ id: workoutSessions.id })
  if (written.length === 0) throw notFound('session')

  return await get(caller, id)
}

export async function logSet(
  caller: Caller,
  sessionId: string,
  input: LogSetInput,
): Promise<SetLog> {
  const [session] = await db
    .select({ id: workoutSessions.id, endedAt: workoutSessions.endedAt })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
    .limit(1)
  if (session === undefined) throw notFound('session')
  if (session.endedAt !== null) throw conflict('That session has already been finished')

  // The exercise must be visible, or a log could reference one the caller cannot see.
  const [exercise] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(visible(exercises, caller), eq(exercises.id, input.exerciseId)))
    .limit(1)
  if (exercise === undefined) throw notFound('exercise')

  /**
   * The entry must belong to a workout the caller can SEE, and must prescribe the exercise being
   * logged. Existence alone let any caller attach a log to a guessed entry id from someone else's
   * plan, which then polluted the entry-keyed joins that progression and history rely on.
   */
  if (input.entryId !== null) {
    const [entry] = await db
      .select({ id: workoutEntries.id, exerciseId: workoutEntries.exerciseId })
      .from(workoutEntries)
      .innerJoin(workoutDays, eq(workoutDays.id, workoutEntries.dayId))
      .innerJoin(workouts, eq(workouts.id, workoutDays.workoutId))
      .where(and(visible(workouts, caller), eq(workoutEntries.id, input.entryId)))
      .limit(1)
    if (entry === undefined) throw notFound('entry')
    if (entry.exerciseId !== input.exerciseId) {
      throw invalid('That entry prescribes a different exercise')
    }
  }

  const [created] = await db
    .insert(setLogs)
    .values({ sessionId, ...input })
    .returning()
  if (created === undefined) throw new Error('Could not record the set')

  return toLog(created)
}

export async function removeLog(caller: Caller, sessionId: string, logId: string): Promise<void> {
  const [session] = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
    .limit(1)
  if (session === undefined) throw notFound('session')

  const deleted = await db
    .delete(setLogs)
    .where(and(eq(setLogs.id, logId), eq(setLogs.sessionId, sessionId)))
    .returning({ id: setLogs.id })
  if (deleted.length === 0) throw notFound('log')
}
