import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type {
  LogSetInput,
  LoggedExercise,
  SessionUpdate,
  SetLog,
  WorkoutSession,
} from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { visibleExercises } from '../../db/visible.ts'
import { conflict, isForeignKeyRefusal, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { assertLoggable } from './loggable.ts'
import { nextNumber } from './numbering.ts'
import { planEntries } from '../workout/plan.ts'

/**
 * Sessions are PERSONAL. They are not `ownable()` — they belong to a `user_id` directly and are
 * never shared, favourited or transferred, so every query here filters on the caller's own id
 * rather than on group membership. See docs/03-domain-model.md.
 */
export const ownedBy = (caller: Caller) => eq(workoutSessions.userId, caller.userId)

export type SessionRow = typeof workoutSessions.$inferSelect
type LogRow = typeof setLogs.$inferSelect

/** `entryId` as the caller sees it — see `get`. */
const toLog = (row: LogRow, exercise: LoggedExercise | null, entryId: string | null): SetLog => ({
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
})

interface LoggedRow {
  readonly log: LogRow
  readonly exercise: LoggedExercise | null
  readonly entryId: string | null
}

export const toSession = (row: SessionRow, logs: readonly LoggedRow[]): WorkoutSession => ({
  id: row.id,
  workoutId: row.workoutId,
  dayId: row.dayId,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  notes: row.notes,
  logs: logs.map((l) => toLog(l.log, l.exercise, l.entryId)),
})

/** Said by every write only a session in progress takes. */
const FINISHED = 'That session has already been finished'

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
    }),
    ...(patch.notes !== undefined && { notes: patch.notes }),
  }

  /**
   * An empty patch is valid input — `SessionUpdate` has only optional fields — but Drizzle throws
   * "No values to set" on `.set({})`, which surfaces as a 500. Exercise and workout updates escape
   * this only because they always touch `updated_at`; `workout_sessions` has no such column.
   */
  if (Object.keys(columns).length === 0) return await read(caller, id)

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

  return await read(caller, id)
}

/**
 * Locks the caller's session for a write only a session in progress takes — a set, an undo, its
 * finish — and refuses one already finished. Locked, then checked: read without the lock, a finish
 * landing between the check and the write let a set into a session that was already over, or out
 * of one. See GLOSSARY.md, "Session".
 */
async function lockInProgress(tx: Transaction, caller: Caller, id: string): Promise<void> {
  const [locked] = await tx
    .select({ endedAt: workoutSessions.endedAt })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .for('update')
  if (locked === undefined) throw notFound('session')
  if (locked.endedAt !== null) throw conflict(FINISHED)
}

/** A session and its logs, as the caller sees them. Read on its own, it is `plan.ts`'s `get`. */
export async function read(caller: Caller, id: string): Promise<WorkoutSession> {
  const [row] = await db
    .select()
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .limit(1)
  if (row === undefined) throw notFound('session')

  /**
   * LEFT JOINs: every log is the caller's and is listed, but the exercise's name and tracking mode
   * come only while they can still see the exercise — null after losing its group — and so does
   * the plan entry. A set whose entry is gone or out of reach reads `entryId: null`, as one logged
   * without a plan, which is exactly how the server numbers it (see `nextNumber`): the screen's
   * "N done" and the next number cannot disagree.
   */
  const exercises = visibleExercises(caller)
  const plan = planEntries(caller, row.workoutId)
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

  return toSession(
    row,
    logs.map((l) => ({
      log: l.log,
      exercise:
        l.name === null || l.tracking === null ? null : { name: l.name, tracking: l.tracking },
      entryId: l.entryId,
    })),
  )
}

/**
 * One performed set. With an `idempotencyKey`, a repeat of a key already stored in this session is
 * answered with the stored set — the same request, so the same answer, even if the session was
 * finished or its plan changed since. See `IDEMPOTENCY_KEY_HEADER` in the contract.
 */
export async function logSet(
  caller: Caller,
  sessionId: string,
  input: LogSetInput,
  idempotencyKey?: string,
): Promise<SetLog> {
  const [session] = await db
    .select({ workoutId: workoutSessions.workoutId })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
    .limit(1)
  if (session === undefined) throw notFound('session')
  const stored = await storedByKey(caller, sessionId, idempotencyKey)
  if (stored !== undefined) return stored
  const exercises = await assertLoggable(caller, session.workoutId, [input])

  const created = await db.transaction(async (tx) => {
    // `workout_id` never changes after a session starts, so the validation above needs no lock.
    await lockInProgress(tx, caller, sessionId)

    const setIndex = await nextNumber(tx, caller, { id: sessionId, ...session }, input)
    // A key stored meanwhile — two sends of one set at once — is skipped, and answered below.
    const [row] = await tx
      .insert(setLogs)
      .values({ sessionId, ...input, setIndex, idempotencyKey })
      .onConflictDoNothing({
        target: [setLogs.sessionId, setLogs.idempotencyKey],
        where: isNotNull(setLogs.idempotencyKey),
      })
      .returning()
      .catch(rethrowMissingEntry)
    // The entry it names was checked reachable by `assertLoggable`, so it is seen as stored.
    return row === undefined ? null : toLog(row, exercises.get(row.exerciseId) ?? null, row.entryId)
  })
  if (created !== null) return created
  const replayed = await storedByKey(caller, sessionId, idempotencyKey)
  if (replayed === undefined) throw new Error('A stored key has no set')
  return replayed
}

/**
 * The set a key stored, as reading the session shows it now — names and entries as visible. A key
 * names ONE request: a repeat is answered with what the first stored, its body not compared.
 */
async function storedByKey(
  caller: Caller,
  sessionId: string,
  key: string | undefined,
): Promise<SetLog | undefined> {
  if (key === undefined) return undefined
  const [row] = await db
    .select({ id: setLogs.id })
    .from(setLogs)
    .where(and(eq(setLogs.sessionId, sessionId), eq(setLogs.idempotencyKey, key)))
    .limit(1)
  if (row === undefined) return undefined
  return (await read(caller, sessionId)).logs.find((log) => log.id === row.id)
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

/** An undo: only of a session in progress — finishing is final, and nothing is undone after it. */
export async function removeLog(caller: Caller, sessionId: string, logId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockInProgress(tx, caller, sessionId)
    const deleted = await tx
      .delete(setLogs)
      .where(and(eq(setLogs.id, logId), eq(setLogs.sessionId, sessionId)))
      .returning({ id: setLogs.id })
    if (deleted.length === 0) throw notFound('log')
  })
}
