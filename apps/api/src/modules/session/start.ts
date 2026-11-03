import { and, eq, isNull } from 'drizzle-orm'
import type { SessionStart, WorkoutSession } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import { visibleWorkoutDays, visibleWorkouts } from '../../db/visible.ts'
import { conflict, invalid, isUniqueViolation, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownedBy, toSession } from './service.ts'

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

/**
 * `workoutId` and `dayId` are optional: walking into the gym and lifting without a plan uses the
 * same tables and feeds the same history. When they ARE given, both must be visible and the day
 * must belong to the workout — otherwise a session could reference someone else's plan.
 */
export async function assertStartable(caller: Caller, input: SessionStart): Promise<void> {
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
