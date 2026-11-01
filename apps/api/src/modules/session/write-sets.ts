import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { REST_EXTENSION_S, type RestChange, type SetLog, type SetLogUpdate } from '@cedo/contract'
import { type Transaction, db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { notFound } from '../../lib/error.ts'
import type { Caller } from '../../plugins/auth.ts'
import { assertWeightFor } from './loggable.ts'
import { restNow } from './rest.ts'
import { NO_REST, lockInProgress, lockOwn, own, ownedBy, read } from './service.ts'

/**
 * The writes to a session's sets, and the rest it keeps running after them (#38): the contract's
 * `restOf` — the app's own rule, so the phone and the server agree — then +30 s or skipped as the
 * athlete says. What the countdown counts to, on every device. Skipped, it ends when it began:
 * kept, so a reload or another device reads it skipped. See docs/adr/0025-rest-kept-by-the-server.md.
 */

/**
 * Every write to a session's sets (#24, #31): under the session's row lock — so they are taken in
 * turn, and the next set's number is read from the sets as they stand — then the rest it has
 * running worked out again, so no write leaves a rest its sets no longer say. `inProgress` refuses
 * a finished session; a correction or a removal takes either. Thrown, nothing is written, and the
 * rest is as it was.
 */
export async function writeSets<T>(
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
 * The rest running now, worked out again: after a set is logged — or sent again, or one undone. The
 * same rest as before — a set sent twice, an older one undone — keeps its +30 s and its skip; a new
 * one starts as long as its set says. None runs in a finished session.
 */
async function keepRest(caller: Caller, sessionId: string): Promise<void> {
  const rest = await restNow(caller, sessionId)
  if (rest === null) {
    await db
      .update(workoutSessions)
      .set(NO_REST)
      .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
    return
  }
  // ISO strings, cast in SQL: a JS Date inside raw `sql` bypasses the column encoder.
  const since = sql`${rest.since}::timestamptz`
  const ends = new Date(Date.parse(rest.since) + rest.seconds * 1000).toISOString()
  const same = sql`${workoutSessions.restSince} = ${since}`
  await db
    .update(workoutSessions)
    .set({
      restSince: sql`${since}`,
      restEndsAt: sql`case when ${same} then ${workoutSessions.restEndsAt} else ${ends}::timestamptz end`,
    })
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
}

/**
 * +30 s, or skip — of the rest running after the session's `sets`th set, and only that one. Named
 * by how many sets there were when it was tapped, not by a time: a set logged without a signal is
 * dated by the phone until the server has it, and by the server after. Sent in the session's queue
 * behind the sets, a change finds its rest still running — or, the next set logged since, changes
 * nothing.
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
  await writeSets(caller, sessionId, { inProgress: false }, async (tx) => {
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
  await writeSets(caller, sessionId, { inProgress: false }, async (tx) => {
    const deleted = await tx
      .delete(setLogs)
      .where(and(eq(setLogs.id, logId), eq(setLogs.sessionId, sessionId)))
      .returning({ id: setLogs.id })
    if (deleted.length === 0) throw notFound('log')
  })
}
