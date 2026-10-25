import { asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { setLogs, workoutSessions } from '../../db/schema.ts'
import { type Training, sessionsOf } from './service.ts'

/**
 * The exercises a training logged most lately, latest first, by id (#27) — whether the reader can
 * still see them or not: that is theirs to decide (`exercise/service.ts`, `recent`). Ids only, so
 * nothing here names anything. One grouped read, however long the history; two logged at the same
 * moment, by id.
 */
export async function recentlyLogged(training: Training, limit: number): Promise<string[]> {
  const latest = sql`max(${setLogs.loggedAt})`
  const rows = await db
    .select({ exerciseId: setLogs.exerciseId })
    .from(setLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, setLogs.sessionId))
    .where(sessionsOf(training))
    .groupBy(setLogs.exerciseId)
    .orderBy(desc(latest), asc(setLogs.exerciseId))
    .limit(limit)
  return rows.map((r) => r.exerciseId)
}
