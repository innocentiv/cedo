import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import {
  type LoggedExercise,
  REST_EXTENSION_S,
  type RestChange,
  type SessionUpdate,
  type SetLog,
  type WorkoutSession,
  personalBestsIn,
} from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises } from '../../db/visible.ts'
import { conflict, isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { earlierBests } from './bests.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * Whose training a read is of, and who reads it — two things the caller used to be at once (#11).
 * `reader` decides what is visible: ADR-0019's relations, so the names of exercises, plans and days.
 * `athleteId` decides whose sessions are read, and nothing else.
 *
 * Reading your own is `own(caller)`. A coach reading an athlete gets one only from
 * `coaching/service.ts`, once the athlete shares their training with a group the coach edits.
 * See docs/adr/0021-coaching-through-groups.md.
 */
export interface Training {
  readonly reader: Caller
  readonly athleteId: string
}

export const own = (caller: Caller): Training => ({ reader: caller, athleteId: caller.userId })

/** The sessions of this training: whose they are, never what the reader may see of them. */
export const sessionsOf = (training: Training) => eq(workoutSessions.userId, training.athleteId)

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
  rpe: row.rpe,
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

/** Said by every write only a session in progress takes. */
const FINISHED = 'That session has already been finished'

/** No rest running (#38): its set undone, or the session finished. */
export const NO_REST = { restSince: null, restEndsAt: null } as const

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
      endedAt: sql<Date>`greatest(${patch.endedAt}::timestamptz, ${workoutSessions.startedAt})`,
      // Finished, no rest runs on (#38).
      ...NO_REST,
    }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
  }

  /**
   * An empty patch is valid input — `SessionUpdate` has only optional fields — but Drizzle throws
   * "No values to set" on `.set({})`, which surfaces as a 500. Exercise and workout updates escape
   * this only because they always touch `updated_at`; `workout_sessions` has no such column.
   */
  if (Object.keys(columns).length === 0) return await read(own(caller), id)

  await db.transaction(async (tx) => {
    // Finishing is final, and once: only a session in progress is finished. Notes are not a
    // change to what was logged, so they need neither the lock nor a session in progress.
    if (patch.endedAt !== undefined) await lockInProgress(tx, caller, id)
    const written = await tx
      .update(workoutSessions)
      .set(columns)
      .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
      .returning({ id: workoutSessions.id })
    if (written.length === 0) throw notFound('session')
  })

  return await read(own(caller), id)
}

/**
 * Locks the caller's session for a write to its sets, and says whether it is finished. Every write
 * to its sets takes this lock (`writeSessionSets`), so they are taken in turn: the next set's
 * number is read from the sets as they stand.
 */
export async function lockOwn(
  tx: Transaction,
  caller: Caller,
  id: string,
): Promise<{ finished: boolean }> {
  const [locked] = await tx
    .select({ endedAt: workoutSessions.endedAt })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .for('update')
  if (locked === undefined) throw notFound('session')
  return { finished: locked.endedAt !== null }
}

/**
 * Locks the caller's session for a write only a session in progress takes — a set, its finish —
 * and refuses one already finished. Locked, then checked: read without the lock, a finish landing
 * between the check and the write let a set into a session that was already over. See GLOSSARY.md,
 * "Session".
 */
export async function lockInProgress(tx: Transaction, caller: Caller, id: string): Promise<void> {
  if ((await lockOwn(tx, caller, id)).finished) throw conflict(FINISHED)
}

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

/**
 * A whole session deleted (#31) — one started by mistake, or logged twice — and its sets with it,
 * in progress or finished. Its row lock is the one every write to its sets takes, so a set being
 * logged lands before it, and goes with it, or finds no session.
 */
export async function remove(caller: Caller, id: string): Promise<void> {
  const deleted = await db
    .delete(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .returning({ id: workoutSessions.id })
  if (deleted.length === 0) throw notFound('session')
}
