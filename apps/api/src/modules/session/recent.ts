import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import type { Caller } from '../../plugins/auth.ts'
import { ownedBy } from './service.ts'

/**
 * The exercises the caller logged most lately, latest first, by id (#27) — whether they can still
 * see them or not: that is the reader's to decide (`exercise/service.ts`, `recent`). Ids only, so
 * nothing here names anything. Their own sessions, one grouped read, however long the history.
 */
export async function recentlyLogged(caller: Caller, limit: number): Promise<string[]> {
  const latest = sql`max(${setLogs.loggedAt})`
  const rows = await db
    .select({ exerciseId: setLogs.exerciseId })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(ownedBy(caller))
    .groupBy(setLogs.exerciseId)
    .orderBy(desc(latest))
    .limit(limit)
  return rows.map((r) => r.exerciseId)
}
