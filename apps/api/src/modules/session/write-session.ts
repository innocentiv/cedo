import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { SessionUpdate, WorkoutSession } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type StepScope, retakeSteps } from '../progression/service.ts'
import { keepRest } from './rest.ts'
import { NO_REST, lockInProgress, lockOwn, ownedBy, readOwn } from './service.ts'

/**
 * The writes to a whole session that move a person's targets (ADR-0026): finishing it takes its
 * steps, and deleting a finished one takes the steps after it again — each in the transaction that
 * makes the change.
 */

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
  if (Object.keys(columns).length === 0) return await readOwn(caller, id)

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
    // Finishing is what takes the session's steps (ADR-0026), under the same lock.
    if (patch.endedAt !== undefined) await takeStepsOf(tx, caller, id)
  })

  return await readOwn(caller, id)
}

/**
 * A whole session deleted (#31) — one started by mistake, or logged twice — and its sets with it,
 * in progress or finished. Its row lock is the one every write to its sets takes, so a set being
 * logged lands before it, and goes with it, or finds no session.
 */
export async function remove(caller: Caller, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Locked first, then read: a finished session's steps go with it, and those after it are
    // taken again — read before they go. One in progress took none.
    const { finished } = await lockOwn(tx, caller, id)
    const scope = finished ? await stepScopeOf(tx, caller, id) : null
    const deleted = await tx
      .delete(workoutSessions)
      .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
      .returning({ id: workoutSessions.id })
    if (deleted.length === 0) throw notFound('session')
    await retakeSteps(tx, caller, scope)
  })
}

/**
 * Which entries a session of the caller's trained, and when it started: what its steps cover. The
 * session's to say — its tables — and progression's to take (ADR-0026).
 */
async function stepScopeOf(tx: Transaction, caller: Caller, id: string): Promise<StepScope | null> {
  const [session] = await tx
    .select({ startedAt: workoutSessions.startedAt })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .limit(1)
  if (session === undefined) return null
  const trained = await tx
    .selectDistinct({ entryId: setLogs.entryId })
    .from(setLogs)
    .where(and(eq(setLogs.sessionId, id), isNotNull(setLogs.entryId)))
  return {
    entryIds: trained.flatMap((t) => (t.entryId === null ? [] : [t.entryId])),
    startedAt: session.startedAt,
  }
}

/** A session's steps, taken: when it is finished, or logged whole — in that write's transaction. */
export async function takeStepsOf(tx: Transaction, caller: Caller, id: string): Promise<void> {
  await retakeSteps(tx, caller, await stepScopeOf(tx, caller, id))
}

/**
 * Every write to a session's sets (#24, #31): under the session's row lock — so they are taken in
 * turn, and the next set's number is read from the sets as they stand — then the rest it has
 * running worked out again and kept (`keepRest`, #38). `inProgress` refuses a finished session; a
 * correction or a removal takes either. Thrown, nothing is written, and the rest is as it was. The
 * rest is kept after the write is committed, outside the lock, as it always was: two writes at once
 * may keep theirs in either order, and the next write puts it right.
 *
 * A finished session's steps follow what it is corrected to (ADR-0026), and every step after it:
 * what it trained is read BEFORE the write — so the entry of a set removed, its last there, is
 * still taken again — and its steps re-taken after it, in the same transaction.
 */
export async function writeSessionSets<T>(
  caller: Caller,
  sessionId: string,
  { inProgress }: { readonly inProgress: boolean },
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const written = await db.transaction(async (tx) => {
    if (inProgress) {
      await lockInProgress(tx, caller, sessionId)
      return await write(tx)
    }
    const { finished } = await lockOwn(tx, caller, sessionId)
    const scope = finished ? await stepScopeOf(tx, caller, sessionId) : null
    const result = await write(tx)
    await retakeSteps(tx, caller, scope)
    return result
  })
  await keepRest(caller, sessionId)
  return written
}
