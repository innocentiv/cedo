import { and, eq, isNotNull } from 'drizzle-orm'
import type { LogSetInput, SetLog } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { startRest } from '../rest/service.ts'
import { assertLoggable } from './loggable.ts'
import { nextNumber } from './numbering.ts'
import { lockInProgress, own, ownedBy, read, rethrowMissingEntry } from './service.ts'

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
  await assertLoggable(caller, session.workoutId, [input])

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
    return row ?? null
  })
  if (created !== null) {
    // The rest it starts, kept so its end can be told with the app closed (#38).
    await startRest(caller, sessionId)
    // Answered as read, so it says what a read says of it — whether it was a personal best.
    return await storedById(caller, sessionId, created.id)
  }
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
