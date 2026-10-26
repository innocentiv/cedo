import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { NO_TARGET, type Rest, restOf } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutSets } from '../../db/visible.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownedBy } from '../session/service.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * The rest running now in one of the caller's sessions, as the contract's `restOf` says (#38) — read
 * narrowly, in four queries, since it is read with every set logged: the session, its sets, its
 * day's entries — whether the caller can see each exercise, never its name — and their sets' kinds.
 * The whole session read hydrates every exercise of the day, which a rest does not need.
 */
export async function restNow(caller: Caller, sessionId: string): Promise<Rest | null> {
  const [session] = await db
    .select({ workoutId: workoutSessions.workoutId, dayId: workoutSessions.dayId })
    .from(workoutSessions)
    // In progress only: a finished session rests no more.
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId), isNull(workoutSessions.endedAt)))
    .limit(1)
  if (session === undefined) return null
  const logs = await db
    .select({
      id: setLogs.id,
      entryId: setLogs.entryId,
      isWarmup: setLogs.isWarmup,
      loggedAt: setLogs.loggedAt,
      reps: setLogs.reps,
      weightG: setLogs.weightG,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
    })
    .from(setLogs)
    .where(eq(setLogs.sessionId, sessionId))
    .orderBy(asc(setLogs.loggedAt))
  // Rows read for this alone: dated as a set is read, in place.
  const flow = logs.map((l) => Object.assign(l, { loggedAt: l.loggedAt.toISOString() }))
  if (session.dayId === null) return restOf(null, flow)
  return restOf(await dayOf(caller, session.workoutId, session.dayId), flow)
}

/** The day as `restOf` reads it: entries, their rests, their sets' kinds, which can be logged. */
async function dayOf(caller: Caller, workoutId: string | null, dayId: string) {
  const plan = planEntries(caller, workoutId)
  const exercises = visibleExercises(caller)
  const entries = await db
    .select({
      id: plan.id,
      index: plan.index,
      supersetGroup: plan.supersetGroup,
      restSeconds: plan.restSeconds,
      seen: exercises.id,
    })
    .from(plan)
    .leftJoin(exercises, eq(exercises.id, plan.exerciseId))
    .where(eq(plan.dayId, dayId))
  const sets = visibleWorkoutSets(caller)
  const kinds =
    entries.length === 0
      ? []
      : await db
          .select({ entryId: sets.entryId, index: sets.index, isWarmup: sets.isWarmup })
          .from(sets)
          .where(
            inArray(
              sets.entryId,
              entries.map((e) => e.id),
            ),
          )
  return {
    entries: entries.map((e) => ({
      id: e.id,
      index: e.index,
      supersetGroup: e.supersetGroup,
      restSeconds: e.restSeconds,
      // Out of reach, nothing can be logged against it: it is never next.
      exercise: e.seen === null ? null : {},
      sets: kinds
        .filter((s) => s.entryId === e.id)
        .map((s) => ({ index: s.index, isWarmup: s.isWarmup, target: NO_TARGET })),
    })),
  }
}
