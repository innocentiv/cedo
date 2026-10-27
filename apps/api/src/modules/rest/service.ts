import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { REST_EXTENSION_S, type RestChange } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { NO_REST, ownedBy, removeLog } from '../session/service.ts'
import { restNow } from './day.ts'

/**
 * The rest a session has running, as the server keeps it (#38): worked out as each set is logged by
 * the contract's `restOf` — the app's own rule, so the phone and the server agree — then +30 s or
 * skipped as the athlete says. What the countdown counts to, on every device. Skipped, it ends when it began: kept, so a reload or another device reads it skipped.
 * See docs/adr/0025-rest-kept-by-the-server.md.
 */

/**
 * The rest running now, worked out again: after a set is logged — or sent again, or one undone. The
 * same rest as before — a set sent twice, an older one undone — keeps its +30 s and its skip; a new
 * one starts as long as its set says. None runs in a finished session.
 */
export async function startRest(caller: Caller, sessionId: string): Promise<void> {
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

/** A set undone (#24), or a past one removed (#31): the rest running is worked out again. */
export async function removeSet(caller: Caller, sessionId: string, logId: string): Promise<void> {
  await removeLog(caller, sessionId, logId)
  await startRest(caller, sessionId)
}
