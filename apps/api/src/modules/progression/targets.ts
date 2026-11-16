import { and, eq } from 'drizzle-orm'
import type { SessionEntryTarget } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { loadsOf } from '../equipment/held.ts'
import { sessionTargetsOf } from './evaluate.ts'
import { loadEntries } from './entries.ts'
import { lastTimes } from './last-times.ts'

/**
 * What a session asks of each entry of the day it follows — the logger's pre-fill — and what was
 * done last time. See `SessionEntryTarget`.
 *
 * The caller's target as their steps left it (ADR-0026). A session takes its step only when it is
 * finished, so its own sets never move what it asks mid-session. A session following no day, or a
 * day out of the caller's reach, asks nothing — there is nothing to offer.
 */
export async function targetsForSession(
  caller: Caller,
  sessionId: string,
): Promise<SessionEntryTarget[]> {
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

  const loaded = await loadEntries(caller, session.workoutId, { dayId: session.dayId })
  if (loaded === null) return []
  const exerciseIds = [...new Set(loaded.entries.map((e) => e.exerciseId))]
  const [last, loadFor] = await Promise.all([
    lastTimes(caller, exerciseIds, session.startedAt),
    loadsOf(caller.userId, caller.weightUnit),
  ])
  return sessionTargetsOf(loaded.entries, loaded.prescribed, loaded.steps, loadFor, last)
}
