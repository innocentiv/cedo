import { and, eq, isNull, sql } from 'drizzle-orm'
import type { SessionLogInput, SessionStart, WorkoutSession } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleWorkoutDays, visibleWorkouts } from '../../db/visible.ts'
import { conflict, invalid, isUniqueViolation, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { assertLoggable } from './loggable.ts'
import { numberedInOrder } from './numbering.ts'
import { ownedBy, read, rethrowMissingEntry, toSession } from './service.ts'

/**
 * How a session comes to be: started, to be trained — one in progress at a time — or logged whole
 * and already finished, as an AI records training it was told about.
 */

/** Said once, for the check and for the index that backs it. */
const IN_PROGRESS = 'A session is already in progress'

/**
 * One session in progress at a time: checked first, for the common case, and held by the partial
 * unique index for the rare one — two starts arriving together both pass a check and only one
 * insert. See GLOSSARY.md, "Session".
 */
export async function start(caller: Caller, input: SessionStart): Promise<WorkoutSession> {
  await assertStartable(caller, input)
  const [open] = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(ownedBy(caller), isNull(workoutSessions.endedAt)))
    .limit(1)
  if (open !== undefined) throw conflict(IN_PROGRESS)

  const [created] = await db
    .insert(workoutSessions)
    .values({ userId: caller.userId, workoutId: input.workoutId, dayId: input.dayId })
    .returning()
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'workout_sessions_in_progress_idx')) throw conflict(IN_PROGRESS)
      throw error
    })
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

// One INSERT shares one `now()`, and `read` orders logs by `logged_at` then `set_index`, so equal
// timestamps read back interleaved — squat 1, bench 1, squat 2. `logWhole` spaces them instead.
const nowPlusMicros = (n: number) => sql<Date>`now() + ${n}::integer * interval '1 microsecond'`

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
    const rows = numberedInOrder(input.sets).map((set, i) =>
      Object.assign(set, { sessionId: created.id, loggedAt: nowPlusMicros(i) }),
    )
    await tx.insert(setLogs).values(rows).catch(rethrowMissingEntry)
    return created.id
  })

  return await read(caller, id)
}
