import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import {
  type LoggedExercise,
  REST_EXTENSION_S,
  type RestChange,
  type SetLog,
  type WorkoutSession,
  personalBestsIn,
} from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises } from '../../db/visible.ts'
import { isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type Training, own, sessionsOf } from '../coaching/training.ts'
import { earlierBests } from './bests.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * Sessions are PERSONAL. They are not `ownable()` — they belong to a `user_id` directly and are
 * never shared, favourited or transferred: a write is only ever to the caller's own, and a read of
 * someone else's goes through `Training`. See docs/03-domain-model.md.
 */
export const ownedBy = (caller: Caller) => sessionsOf(own(caller))

export type SessionRow = typeof workoutSessions.$inferSelect
type LogRow = typeof setLogs.$inferSelect

/** `entryId` as the caller sees it — see `get`. */
const toLog = (
  row: LogRow,
  exercise: LoggedExercise | null,
  entryId: string | null,
  personalBest: boolean,
): SetLog => ({
  id: row.id,
  entryId,
  exerciseId: row.exerciseId,
  exercise,
  setIndex: row.setIndex,
  isWarmup: row.isWarmup,
  weightG: row.weightG,
  reps: row.reps,
  reserve: row.reserve,
  durationS: row.durationS,
  distanceMm: row.distanceMm,
  loggedAt: row.loggedAt.toISOString(),
  personalBest,
})

interface LoggedRow {
  readonly log: LogRow
  readonly exercise: LoggedExercise | null
  readonly entryId: string | null
  readonly personalBest: boolean
}

export const toSession = (row: SessionRow, logs: readonly LoggedRow[]): WorkoutSession => ({
  id: row.id,
  workoutId: row.workoutId,
  dayId: row.dayId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  notes: row.notes,
  logs: logs.map((l) => toLog(l.log, l.exercise, l.entryId, l.personalBest)),
  rest:
    row.restSince === null || row.restEndsAt === null
      ? null
      : { since: row.restSince.toISOString(), endsAt: row.restEndsAt.toISOString() },
})

/**
 * +30 s, or skip — of the rest running after the session's `sets`th set, and only that one (#38).
 * Named by how many sets there were when it was tapped, not by a time: a set logged without a
 * signal is dated by the phone until the server has it, and by the server after. Sent in the
 * session's queue behind the sets, a change finds its rest still running — or, the next set logged
 * since, changes nothing. Skipped, it ends when it began: kept, so a reload or another device reads
 * it skipped.
 */
export async function changeRest(
  caller: Caller,
  sessionId: string,
  { sets, change }: RestChange,
): Promise<void> {
  const logged = db.$count(setLogs, eq(setLogs.sessionId, workoutSessions.id))
  await db
    .update(workoutSessions)
    .set(
      change === 'skip'
        ? { restEndsAt: sql`${workoutSessions.restSince}` }
        : {
            restEndsAt: sql`${workoutSessions.restEndsAt} + make_interval(secs => ${REST_EXTENSION_S})`,
          },
    )
    .where(
      and(
        ownedBy(caller),
        eq(workoutSessions.id, sessionId),
        isNotNull(workoutSessions.restSince),
        sql`${logged} = ${sets}`,
      ),
    )
}

/** One of the caller's own sessions, read back after a write to it. */
export const readOwn = async (caller: Caller, id: string): Promise<WorkoutSession> =>
  await read(own(caller), id)

/** A session and its logs, as the caller sees them. Read on its own, it is `plan.ts`'s `get`. */
export async function read(training: Training, id: string): Promise<WorkoutSession> {
  const [row] = await db
    .select()
    .from(workoutSessions)
    .where(and(sessionsOf(training), eq(workoutSessions.id, id)))
    .limit(1)
  if (row === undefined) throw notFound('session')

  /**
   * LEFT JOINs: every log is the caller's and is listed, but the exercise's name and tracking mode
   * come only while they can still see the exercise — null after losing its group — and so does
   * the plan entry. A set whose entry is gone or out of reach reads `entryId: null`, as one logged
   * without a plan, which is exactly how the server numbers it (see `nextNumber`): the screen's
   * "N done" and the next number cannot disagree.
   */
  const exercises = visibleExercises(training.reader)
  const plan = planEntries(training.reader, row.workoutId)
  const logs = await db
    .select({
      log: setLogs,
      name: exercises.name,
      tracking: exercises.tracking,
      entryId: plan.id,
    })
    .from(setLogs)
    .leftJoin(exercises, eq(exercises.id, setLogs.exerciseId))
    .leftJoin(plan, eq(plan.id, setLogs.entryId))
    .where(eq(setLogs.sessionId, id))
    .orderBy(asc(setLogs.loggedAt), asc(setLogs.setIndex))

  // Judged only of what the reader can see: an exercise out of reach has no mode to judge it by.
  const tracking = new Map(
    logs.flatMap((l) => (l.tracking === null ? [] : [[l.log.exerciseId, l.tracking] as const])),
  )
  const bests = personalBestsIn(
    logs.map((l) => l.log),
    await earlierBests(sessionsOf(training), row.startedAt, [...tracking.keys()]),
    (exerciseId) => tracking.get(exerciseId) ?? null,
  )
  return toSession(
    row,
    logs.map((l) => ({
      log: l.log,
      exercise:
        l.name === null || l.tracking === null ? null : { name: l.name, tracking: l.tracking },
      entryId: l.entryId,
      personalBest: bests.has(l.log.id),
    })),
  )
}

/**
 * A plan save can delete an entry between `assertLoggable` and the insert — validation reads, it
 * does not lock. The foreign key then refuses the insert; that is the same "No such entry" the
 * check would have given a moment later, not a 500. The transaction rolls back either way.
 */
export function rethrowMissingEntry(error: unknown): never {
  if (isForeignKeyRefusal(error)) throw notFound('entry')
  throw error
}
