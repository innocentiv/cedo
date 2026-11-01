import { and, eq, isNotNull } from 'drizzle-orm'
import type { LogSetInput, SetLog, SetLogUpdate } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { assertLoggable, assertWeightFor } from './loggable.ts'
import { nextNumber } from './numbering.ts'
import { keepRest } from './rest.ts'
import { lockInProgress, lockOwn, own, ownedBy, read, rethrowMissingEntry } from './service.ts'

/**
 * Every write to a session's sets (#24, #31): under the session's row lock — so they are taken in
 * turn, and the next set's number is read from the sets as they stand — then the rest it has
 * running worked out again and kept (`keepRest`, #38). `inProgress` refuses a finished session; a
 * correction or a removal takes either. Thrown, nothing is written, and the rest is as it was. The
 * rest is kept after the write is committed, outside the lock, as it always was: two writes at once
 * may keep theirs in either order, and the next write puts it right.
 */
export async function writeSessionSets<T>(
  caller: Caller,
  sessionId: string,
  { inProgress }: { readonly inProgress: boolean },
  write: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const written = await db.transaction(async (tx) => {
    if (inProgress) await lockInProgress(tx, caller, sessionId)
    else await lockOwn(tx, caller, sessionId)
    return await write(tx)
  })
  await keepRest(caller, sessionId)
  return written
}

/**
 * One performed set. With an `idempotencyKey`, a repeat of a key already stored in this session is
 * answered with the stored set — the same request, so the same answer, even if the session was
 * finished or its plan changed since — and keeps nothing: the first send kept its rest. See
 * `IDEMPOTENCY_KEY_HEADER` in the contract.
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
  await assertLoggable(caller, session.workoutId, [input])

  // `workout_id` never changes after a session starts, so the validation above needs no lock.
  const created = await writeSessionSets(caller, sessionId, { inProgress: true }, async (tx) => {
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
    return row ?? null
  })
  // Answered as read, so it says what a read says of it — whether it was a personal best.
  if (created !== null) return await storedById(caller, sessionId, created.id)
  const replayed = await storedByKey(caller, sessionId, idempotencyKey)
  if (replayed === undefined) throw new Error('A stored key has no set')
  return replayed
}

/** A set as a read of its session shows it — names, entries and personal bests as visible. */
async function storedById(caller: Caller, sessionId: string, id: string): Promise<SetLog> {
  const stored = (await read(own(caller), sessionId)).logs.find((log) => log.id === id)
  if (stored === undefined) throw new Error('A stored set is not in its session')
  return stored
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
  return await storedById(caller, sessionId, row.id)
}

/**
 * A set corrected (#31): how hard it was, said after it (#24), or a past mistake fixed — in a
 * session in progress or finished, with no time limit: it is the caller's own record. Personal
 * bests, progression and the review are computed on read, so they follow it — and the rest is
 * worked out again, a set corrected to a warm-up, or from one, saying a rest of its own. A weight is
 * judged as a logged one is (`assertWeightFor`), and the correction is rolled back with it.
 */
export async function amendLog(
  caller: Caller,
  sessionId: string,
  logId: string,
  patch: SetLogUpdate,
): Promise<SetLog> {
  await writeSessionSets(caller, sessionId, { inProgress: false }, async (tx) => {
    // Drizzle throws on `.set({})`; an empty correction changes nothing, and answers the set.
    if (Object.keys(patch).length === 0) return
    const [amended] = await tx
      .update(setLogs)
      .set(patch)
      .where(and(eq(setLogs.id, logId), eq(setLogs.sessionId, sessionId)))
      .returning({ exerciseId: setLogs.exerciseId })
    if (amended === undefined) throw notFound('log')
    if (patch.weightG !== undefined)
      await assertWeightFor(tx, caller, amended.exerciseId, patch.weightG)
  })
  const amended = (await read(own(caller), sessionId)).logs.find((log) => log.id === logId)
  if (amended === undefined) throw notFound('log')
  return amended
}

/**
 * A set removed: an undo while the session is in progress, or a past mistake fixed once it is
 * finished (#31). Under the session's lock, so undoing the last set frees its number for the next.
 */
export async function removeLog(caller: Caller, sessionId: string, logId: string): Promise<void> {
  await writeSessionSets(caller, sessionId, { inProgress: false }, async (tx) => {
    const deleted = await tx
      .delete(setLogs)
      .where(and(eq(setLogs.id, logId), eq(setLogs.sessionId, sessionId)))
      .returning({ id: setLogs.id })
    if (deleted.length === 0) throw notFound('log')
  })
}
