import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type {
  LogSetInput,
  Page,
  SessionQuery,
  SessionStart,
  SessionUpdate,
  SetLog,
  WorkoutSession,
  WorkoutSessionSummary,
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
const ownedBy = (caller: Caller) => eq(workoutSessions.userId, caller.userId)

type SessionRow = typeof workoutSessions.$inferSelect
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

export async function list(
  caller: Caller,
  query: SessionQuery,
): Promise<Page<WorkoutSessionSummary>> {
  const conditions = [ownedBy(caller)]
  if (query.workoutId !== undefined) conditions.push(eq(workoutSessions.workoutId, query.workoutId))
  if (query.since !== undefined)
    conditions.push(sql`${workoutSessions.startedAt} >= ${query.since}`)
  // Keyset on started_at descending, matching workout_sessions_user_time_idx.
  if (query.cursor !== undefined) {
    const at = new Date(query.cursor)
    if (!Number.isNaN(at.getTime())) conditions.push(lt(workoutSessions.startedAt, at))
  }

  const rows = await db
    .select({ session: workoutSessions, workoutName: workouts.name, dayName: workoutDays.name })
    .from(workoutSessions)
    .leftJoin(workouts, eq(workouts.id, workoutSessions.workoutId))
    .leftJoin(workoutDays, eq(workoutDays.id, workoutSessions.dayId))
    .where(and(...conditions))
    .orderBy(desc(workoutSessions.startedAt))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const items = rows.slice(0, query.limit)

  const totalBySession = await totalsFor(items.map((r) => r.session.id))

  return {
    items: items.map((r) => {
      const total = totalBySession.get(r.session.id)
      return {
        id: r.session.id,
        workoutId: r.session.workoutId,
        dayId: r.session.dayId,
        startedAt: r.session.startedAt.toISOString(),
        endedAt: r.session.endedAt?.toISOString() ?? null,
        notes: r.session.notes,
        workoutName: r.workoutName,
        dayName: r.dayName,
        setCount: total?.sets ?? 0,
        totalVolumeG: total?.volume ?? 0,
      }
    }),
    nextCursor: hasMore ? (items.at(-1)?.session.startedAt.toISOString() ?? null) : null,
  }
}

/**
 * Set counts and volume for a whole page in ONE grouped query, never one per session. Warm-ups are
 * excluded from both — they are not work performed. See docs/adr/0012-progression-rules.md.
 */
async function totalsFor(sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, { sets: number; volume: number }>()

  const totals = await db
    .select({
      sessionId: setLogs.sessionId,
      sets: sql<number>`count(*) filter (where not ${setLogs.isWarmup})`.mapWith(Number),
      volume:
        sql<number>`coalesce(sum(${setLogs.weightG} * ${setLogs.reps}) filter (where not ${setLogs.isWarmup}), 0)`.mapWith(
          Number,
        ),
    })
    .from(setLogs)
    .where(inArray(setLogs.sessionId, sessionIds))
    .groupBy(setLogs.sessionId)

  return new Map(totals.map((t) => [t.sessionId, { sets: t.sets, volume: t.volume }]))
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

  if (input.entryId !== null) {
    const [entry] = await db
      .select({ id: workoutEntries.id })
      .from(workoutEntries)
      .where(eq(workoutEntries.id, input.entryId))
      .limit(1)
    if (entry === undefined) throw notFound('entry')
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
