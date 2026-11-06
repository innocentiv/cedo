import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { SessionUpdate, WorkoutSession } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { conflict, notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type StepScope, retakeSteps } from '../progression/service.ts'
import { keepRest } from './rest.ts'
import { ownedBy, readOwn } from './service.ts'

/**
 * A change to a session (#24, #31; ADR-0026): every write that changes what it holds, or whether it
 * is over — a set logged, corrected or removed, the session finished, deleted, or logged whole —
 * goes through `changeSession`, which keeps what each must: the session's lock, its steps, its rest.
 */

/** What a change asks of the session it changes. */
export interface Change {
  /** Only a session in progress takes it — a set logged, a finish — and one finished is refused. */
  readonly inProgress: boolean
  /** It finishes the session: what the session trained takes its steps. */
  readonly finishes?: boolean
}

/** Said of every change only a session in progress takes. */
const FINISHED = 'That session has already been finished'

/**
 * A change to one of the caller's sessions, in one transaction:
 *
 * - under the session's row lock, so changes are taken in turn — the next set's number is read from
 *   the sets as they stand — and a change only a session in progress takes is refused once it is
 *   finished: locked, then checked, so a finish cannot land between the check and the write;
 * - the steps of every entry it trained taken again, with every step after them (ADR-0026) — of a
 *   session finished before the change, what it trained BEFORE it, read before the write, since a
 *   set removed, its entry's last there, or the session deleted is not there to read after; of one
 *   the change finishes, what it trained once finished. A session in progress takes none;
 * - the rest it has running worked out again and kept (`keepRest`, #38) — none, once it is over —
 *   under the same lock: changes at once keep theirs in the order they are made, never a rest
 *   worked out from sets another change has since overtaken.
 *
 * Thrown, nothing is written — the rest neither: a set sent again finds none stored, and is
 * logged, its rest with it.
 */
export async function changeSession<T>(
  caller: Caller,
  id: string,
  change: Change,
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => await changeIn(tx, caller, id, change, write))
}

/** `changeSession`, in a transaction already open: a session logged whole, started in it. */
export async function changeIn<T>(
  tx: Transaction,
  caller: Caller,
  id: string,
  { inProgress, finishes = false }: Change,
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const [locked] = await tx
    .select({ endedAt: workoutSessions.endedAt })
    .from(workoutSessions)
    .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
    .for('update')
  if (locked === undefined) throw notFound('session')
  const finished = locked.endedAt !== null
  if (inProgress && finished) throw conflict(FINISHED)
  const before = finished ? await trainedBy(tx, caller, id) : null
  const result = await write(tx)
  await retakeSteps(tx, caller, finishes ? await trainedBy(tx, caller, id) : before)
  await keepRest(tx, caller, id)
  return result
}

/**
 * Which entries a session of the caller's trained, and when it started: what its steps cover. The
 * session's to say — its tables — and progression's to take (ADR-0026).
 */
async function trainedBy(tx: Transaction, caller: Caller, id: string): Promise<StepScope | null> {
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

/** A session finished, or its notes amended — or both. */
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
  if (Object.keys(columns).length === 0) return await readOwn(caller, id)

  const written = async (tx: Transaction) => {
    const rows = await tx
      .update(workoutSessions)
      .set(columns)
      .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
      .returning({ id: workoutSessions.id })
    if (rows.length === 0) throw notFound('session')
  }
  // Finishing is a change, and final: once, of a session in progress, and it takes its steps.
  // Notes change nothing logged, so they need neither the lock nor a session in progress.
  if (patch.endedAt === undefined) await db.transaction(written)
  else await changeSession(caller, id, { inProgress: true, finishes: true }, written)

  return await readOwn(caller, id)
}

/**
 * A whole session deleted (#31) — one started by mistake, or logged twice — and its sets with it,
 * in progress or finished. Under its lock, the one every change to its sets takes, a set being
 * logged lands before it, and goes with it, or finds no session. A finished session's steps go
 * with it, and those after it are taken again.
 */
export async function remove(caller: Caller, id: string): Promise<void> {
  await changeSession(caller, id, { inProgress: false }, async (tx) => {
    const deleted = await tx
      .delete(workoutSessions)
      .where(and(ownedBy(caller), eq(workoutSessions.id, id)))
      .returning({ id: workoutSessions.id })
    if (deleted.length === 0) throw notFound('session')
  })
}
