import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { type TrackingMode, personalBestsIn } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises } from '../../db/visible.ts'
import { earlierBests } from './bests.ts'
import { type Training, sessionsOf } from '../coaching/training.ts'

/**
 * How many personal bests each session of a page of history set (#25) — judged as each session's
 * own read judges them (`read`), in three reads for the whole page, never one per session.
 *
 * Every set from the page's oldest session to its newest is walked in the order done, through
 * `personalBestsIn`, starting from what came before the oldest (`earlierBests`): each session is then
 * judged against every one before it, including those a filtered page leaves out. An exercise the
 * reader cannot see has no mode to judge it by, and makes no best — as on the session itself.
 */
export async function bestsPerSession(
  training: Training,
  sessions: readonly { readonly id: string; readonly startedAt: Date }[],
): Promise<Map<string, number>> {
  const times = sessions.map((s) => s.startedAt.getTime())
  if (times.length === 0) return new Map()
  /**
   * A `Date` holds milliseconds and `started_at` microseconds: the newest session's own start reads
   * back a little BELOW it, so the range runs to the millisecond after. The oldest bound is already
   * below its session's start, and earlier ones in the same millisecond are walked, not left out.
   */
  const oldest = new Date(Math.min(...times))
  const newest = new Date(Math.max(...times) + 1)

  const logs = await setsInOrder(training, oldest, newest)
  const tracking = await trackingOf(training, logs)
  const bests = personalBestsIn(
    logs,
    await earlierBests(sessionsOf(training), oldest, [...tracking.keys()]),
    (exerciseId) => tracking.get(exerciseId) ?? null,
  )
  const counts = new Map<string, number>()
  for (const log of logs) {
    if (bests.has(log.id)) counts.set(log.sessionId, (counts.get(log.sessionId) ?? 0) + 1)
  }
  return counts
}

/**
 * Every set of `training`'s sessions started from `oldest` to `newest`, in the order done — sessions
 * by start, then each one's sets as logged. Put in order here, not by the query: sorting the join
 * read every row of the range before the first came back, where the walk down the sessions' index
 * hands them over as it goes.
 */
async function setsInOrder(training: Training, oldest: Date, newest: Date) {
  const logs = await db
    .select({
      id: setLogs.id,
      sessionId: setLogs.sessionId,
      startedAt: workoutSessions.startedAt,
      loggedAt: setLogs.loggedAt,
      setIndex: setLogs.setIndex,
      exerciseId: setLogs.exerciseId,
      isWarmup: setLogs.isWarmup,
      weightG: setLogs.weightG,
      reps: setLogs.reps,
      durationS: setLogs.durationS,
      distanceMm: setLogs.distanceMm,
    })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(
      and(
        sessionsOf(training),
        gte(workoutSessions.startedAt, oldest),
        lte(workoutSessions.startedAt, newest),
      ),
    )
  return logs.toSorted(
    (a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() ||
      a.sessionId.localeCompare(b.sessionId) ||
      a.loggedAt.getTime() - b.loggedAt.getTime() ||
      a.setIndex - b.setIndex,
  )
}

/**
 * How each walked exercise is measured, of those the reader can still see — looked up by id, so a
 * page reads its own few exercises, not the whole library.
 */
async function trackingOf(
  training: Training,
  logs: readonly { readonly exerciseId: string }[],
): Promise<Map<string, TrackingMode>> {
  const ids = [...new Set(logs.map((l) => l.exerciseId))]
  if (ids.length === 0) return new Map()
  const exercises = visibleExercises(training.reader)
  const rows = await db
    .select({ id: exercises.id, tracking: exercises.tracking })
    .from(exercises)
    .where(inArray(exercises.id, ids))
  return new Map(rows.map((r) => [r.id, r.tracking]))
}
