import { and, eq, sql } from 'drizzle-orm'
import { REST_EXTENSION_S, type RestChange, restOf } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { get as getSession } from '../session/plan.ts'
import { NO_REST, own, ownedBy } from '../session/service.ts'

/**
 * The rest a session has running, as the server keeps it (#38): worked out as each set is logged by
 * the contract's `restOf` — the app's own rule, so the phone and the alert agree — then +30 s or
 * skipped as the athlete says, and gone once nothing follows. What the alert is sent at
 * (`alerts.ts`), and what the countdown counts to. See docs/adr/0025-rest-kept-by-the-server.md.
 */

/** After a set is logged: the rest it starts, or none — a warm-up, mid-superset, none prescribed. */
export async function startRest(caller: Caller, sessionId: string): Promise<void> {
  const session = await getSession(own(caller), sessionId)
  const day = session.plan !== null && session.plan.reachable ? session.plan.day : null
  const rest = restOf(day, session.logs)
  await db
    .update(workoutSessions)
    .set(
      rest === null
        ? NO_REST
        : {
            restSince: new Date(rest.since),
            restEndsAt: new Date(Date.parse(rest.since) + rest.seconds * 1000),
            restAlertedAt: null,
          },
    )
    .where(and(ownedBy(caller), eq(workoutSessions.id, sessionId)))
}

/**
 * +30 s, or skip — of the rest that started `since`, and only that one: a change queued offline and
 * sent after the next set began another rest changes nothing. Moved, an alert already sent is due
 * again.
 */
export async function changeRest(
  caller: Caller,
  sessionId: string,
  { since, change }: RestChange,
): Promise<void> {
  await db
    .update(workoutSessions)
    .set(
      change === 'skip'
        ? NO_REST
        : {
            restEndsAt: sql`${workoutSessions.restEndsAt} + make_interval(secs => ${REST_EXTENSION_S})`,
            restAlertedAt: null,
          },
    )
    .where(
      and(
        ownedBy(caller),
        eq(workoutSessions.id, sessionId),
        eq(workoutSessions.restSince, new Date(since)),
      ),
    )
}
