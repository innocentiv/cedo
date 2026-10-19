import { type SQL, and, asc, eq, sql } from 'drizzle-orm'
import type {
  LogSetInput,
  LoggedExercise,
  SessionLogInput,
  SessionStart,
  SessionUpdate,
  SetLog,
  WorkoutSession,
} from '@cedo/contract'
import { nextSetIndex } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutDays, visibleWorkouts } from '../../db/visible.ts'
import { conflict, invalid, isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { assertLoggable } from './loggable.ts'

/**
 * Sessions are PERSONAL. They are not `ownable()` — they belong to a `user_id` directly and are
 * never shared, favourited or transferred, so every query here filters on the caller's own id
 * rather than on group membership. See docs/03-domain-model.md.
 */
export const ownedBy = (caller: Caller) => eq(workoutSessions.userId, caller.userId)

export type SessionRow = typeof workoutSessions.$inferSelect
type LogRow = typeof setLogs.$inferSelect

const toLog = (row: LogRow, exercise: LoggedExercise | null): SetLog => ({
  id: row.id,
  entryId: row.entryId,
  exerciseId: row.exerciseId,
  exercise,
  setIndex: row.setIndex,
  isWarmup: row.isWarmup,
  weightG: row.weightG,
  reps: row.reps,
  rpe: row.rpe,
  durationS: row.durationS,
  distanceMm: row.distanceMm,
  loggedAt: row.loggedAt.toISOString(),
})

interface LoggedRow {
  readonly log: LogRow
  readonly exercise: LoggedExercise | null
}

const toSession = (row: SessionRow, logs: readonly LoggedRow[]): WorkoutSession => ({
  id: row.id,
  workoutId: row.workoutId,
  dayId: row.dayId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  notes: row.notes,
  logs: logs.map((l) => toLog(l.log, l.exercise)),
})

/**
 * `workoutId` and `dayId` are optional: walking into the gym and lifting without a plan uses the
 * same tables and feeds the same history. When they ARE given, both must be visible and the day
 * must belong to the workout — otherwise a session could reference someone else's plan.
 */
export async function start(caller: Caller, input: SessionStart): Promise<WorkoutSession> {
  await assertStartable(caller, input)

  const [created] = await db
    .insert(workoutSessions)
    .values({ userId: caller.userId, workoutId: input.workoutId, dayId: input.dayId })
    .returning()
  if (created === undefined) throw new Error('Could not start the session')

  return toSession(created, [])
}

async function assertStartable(caller: Caller, input: SessionStart): Promise<void> {
  if (input.dayId !== null && input.workoutId === null) {
    throw invalid('A dayId without a workoutId does not identify a plan')
  }

  if (input.workoutId !== null) {
    const workouts = visibleWorkouts(caller)
    const [found] = await db
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.id, input.workoutId))
      .limit(1)
    if (found === undefined) throw notFound('workout')
  }

  if (input.dayId !== null && input.workoutId !== null) {
    const days = visibleWorkoutDays(caller)
    const [day] = await db
      .select({ id: days.id })
      .from(days)
      .where(and(eq(days.id, input.dayId), eq(days.workoutId, input.workoutId)))
      .limit(1)
    if (day === undefined) throw notFound('day')
  }
}

// One INSERT shares one `now()`, and `get` orders logs by `logged_at` then `set_index`, so equal
// timestamps read back interleaved — squat 1, bench 1, squat 2. `logWhole` spaces them instead.
const nowPlusMicros = (n: number) => sql<Date>`now() + ${n}::integer * interval '1 microsecond'`

/**
 * A whole session's rows, in the order sent: each set numbered within its series — a new session
 * has nothing before them — and stamped a microsecond after the last, so they read back as sent.
 */
function rowsInOrder(sessionId: string, sets: readonly LogSetInput[]) {
  const rows: (LogSetInput & { sessionId: string; setIndex: number; loggedAt: SQL<Date> })[] = []
  for (const set of sets) {
    rows.push({
      ...set,
      sessionId,
      setIndex: nextSetIndex(rows, set),
      loggedAt: nowPlusMicros(rows.length),
    })
  }
  return rows
}

/**
 * A whole, finished session in ONE transaction — `session_log` over MCP. Everything is validated
 * before anything is written, so one bad set logs nothing and a retry cannot duplicate the rest.
 * The statement count does not grow with the number of sets. Sets keep the order sent.
 */
export async function logWhole(caller: Caller, input: SessionLogInput): Promise<WorkoutSession> {
  await assertStartable(caller, input)
  await assertLoggable(caller, input.workoutId, input.sets)

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workoutSessions)
      .values({
        userId: caller.userId,
        workoutId: input.workoutId,
        dayId: input.dayId,
        notes: input.notes,
        endedAt: nowPlusMicros(input.sets.length),
      })
      .returning({ id: workoutSessions.id })
    if (created === undefined) throw new Error('Could not record the session')
    await tx.insert(setLogs).values(rowsInOrder(created.id, input.sets)).catch(rethrowMissingEntry)
    return created.id
  })

  return await get(caller, id)
}

export async function get(caller: Caller, id: string): Promise<WorkoutSession> {
  const [row] = await db
    .select()
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .limit(1)
  if (row === undefined) throw notFound('session')

  /**
   * LEFT JOIN onto the visible exercises: every log is the caller's and is listed, but the name and
   * tracking mode come only while they can still see the exercise — null after losing its group.
   */
  const exercises = visibleExercises(caller)
  const logs = await db
    .select({ log: setLogs, name: exercises.name, tracking: exercises.tracking })
    .from(setLogs)
    .leftJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .where(eq(setLogs.sessionId, id))
    .orderBy(asc(setLogs.loggedAt), asc(setLogs.setIndex))

  return toSession(
    row,
    logs.map((l) => ({
      log: l.log,
      exercise:
        l.name === null || l.tracking === null ? null : { name: l.name, tracking: l.tracking },
    })),
  )
}

export async function update(
  caller: Caller,
  id: string,
  patch: SessionUpdate,
): Promise<WorkoutSession> {
  const columns = {
    ...(patch.endedAt !== undefined && {
      /**
       * Never before the start, clamped in SQL against the row's own `started_at`. The app finishes
       * with the PHONE's clock while `started_at` is the database's, so rejecting an earlier end
       * refused any session shorter than the skew — and a refusal is not what anyone wants here.
       * An ISO string, never a JS Date: raw `sql` bypasses the column encoder.
       */
      endedAt:
        patch.endedAt === null
          ? null
          : sql<Date>`greatest(${patch.endedAt}::timestamptz, ${workoutSessions.startedAt})`,
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
    .select({ workoutId: workoutSessions.workoutId })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
    .limit(1)
  if (session === undefined) throw notFound('session')
  const exercises = await assertLoggable(caller, session.workoutId, [input])

  return await db.transaction(async (tx) => {
    /**
     * Locked, then checked: read without a lock, a finish landing between the check and the insert
     * put a set into a session that was already over. `workout_id` never changes after a session
     * starts, so the validation above does not need the lock.
     */
    const [locked] = await tx
      .select({ endedAt: workoutSessions.endedAt })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .for('update')
    // Gone since the ownership read (`undefined`) is a 404, not "already finished".
    if (locked === undefined) throw notFound('session')
    if (locked.endedAt !== null) throw conflict('That session has already been finished')

    // Numbered here, under the lock, so two devices logging at once cannot take the same number.
    // A series never spans exercises, so this one's logs are all that need reading.
    const logged = await tx
      .select({
        entryId: setLogs.entryId,
        exerciseId: setLogs.exerciseId,
        setIndex: setLogs.setIndex,
      })
      .from(setLogs)
      .where(and(eq(setLogs.sessionId, sessionId), eq(setLogs.exerciseId, input.exerciseId)))
    const [created] = await tx
      .insert(setLogs)
      .values({ sessionId, ...input, setIndex: nextSetIndex(logged, input) })
      .returning()
      .catch(rethrowMissingEntry)
    if (created === undefined) throw new Error('Could not record the set')
    return toLog(created, exercises.get(created.exerciseId) ?? null)
  })
}

/**
 * A plan save can delete an entry between `assertLoggable` and the insert — validation reads, it
 * does not lock. The foreign key then refuses the insert; that is the same "No such entry" the
 * check would have given a moment later, not a 500. The transaction rolls back either way.
 */
function rethrowMissingEntry(error: unknown): never {
  if (isForeignKeyRefusal(error)) throw notFound('entry')
  throw error
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
