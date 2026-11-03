import { and, asc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { progressionSteps, setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises, visibleWorkoutEntries, visibleWorkoutSets } from '../../db/visible.ts'
import { groupBy } from '../../lib/keyset.ts'
import type { Caller } from '../../plugins/auth.ts'

/** What taking steps reads (`write-steps.ts`): the entries, their steps, and the sessions since. */

/** The entries the caller can still see, with their rule and their WORKING sets in order. */
export async function ruledEntries(tx: Transaction, caller: Caller, entryIds: readonly string[]) {
  const entries = visibleWorkoutEntries(caller)
  const exercises = visibleExercises(caller)
  const rows = await tx
    .select({
      id: entries.id,
      exerciseId: entries.exerciseId,
      progression: entries.progression,
      tracking: exercises.tracking,
      equipment: exercises.equipment,
    })
    .from(entries)
    .innerJoin(exercises, eq(exercises.id, entries.exerciseId))
    .where(inArray(entries.id, [...entryIds]))
  if (rows.length === 0) return []
  const sets = visibleWorkoutSets(caller)
  const working = await tx
    .select()
    .from(sets)
    .where(
      and(
        inArray(
          sets.entryId,
          rows.map((r) => r.id),
        ),
        eq(sets.isWarmup, false),
      ),
    )
    .orderBy(asc(sets.index))
  const workingByEntry = groupBy(working, (s) => s.entryId)
  return rows.map((r) => Object.assign(r, { working: workingByEntry.get(r.id) ?? [] }))
}

/** Every step of the caller's on these entries, in the order training happened. */
export async function stepsOf(tx: Transaction, caller: Caller, entryIds: readonly string[]) {
  return await tx
    .select({
      entryId: progressionSteps.entryId,
      sessionId: progressionSteps.sessionId,
      kind: progressionSteps.kind,
      takenAt: progressionSteps.takenAt,
      target: progressionSteps.target,
      streak: progressionSteps.streak,
      against: progressionSteps.against,
    })
    .from(progressionSteps)
    .where(
      and(
        eq(progressionSteps.userId, caller.userId),
        inArray(progressionSteps.entryId, [...entryIds]),
      ),
    )
    .orderBy(asc(progressionSteps.takenAt), asc(progressionSteps.id))
}

/** The caller's sets against these entries in FINISHED sessions started from `from`, in order. */
export async function finishedLogs(
  tx: Transaction,
  caller: Caller,
  entryIds: readonly string[],
  from: Date,
) {
  const rows = await tx
    .select({
      entryId: setLogs.entryId,
      sessionId: setLogs.sessionId,
      startedAt: workoutSessions.startedAt,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
      reserve: setLogs.reserve,
      isWarmup: setLogs.isWarmup,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(
      and(
        eq(workoutSessions.userId, caller.userId),
        isNotNull(workoutSessions.endedAt),
        gte(workoutSessions.startedAt, from),
        inArray(setLogs.entryId, [...entryIds]),
      ),
    )
    .orderBy(asc(workoutSessions.startedAt), asc(workoutSessions.id), asc(setLogs.setIndex))
  return rows.flatMap(({ entryId, ...set }) =>
    entryId === null ? [] : [Object.assign(set, { entryId })],
  )
}
