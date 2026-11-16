import { asc, desc, sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import type { Training } from '../coaching/training.ts'
import { setsOf } from './sets-of.ts'

/**
 * The exercises a training logged most lately, latest first, by id (#27) — whether the reader can
 * still see them or not: that is theirs to decide (`exercise/service.ts`, `recent`). Ids only, so
 * nothing here names anything. One grouped read, however long the history; two logged at the same
 * moment, by id.
 */
export async function recentlyLogged(training: Training, limit: number): Promise<string[]> {
  const sets = setsOf(training)
  const latest = sql`max(${sets.loggedAt})`
  const rows = await db
    .select({ exerciseId: sets.exerciseId })
    .from(sets)
    .groupBy(sets.exerciseId)
    .orderBy(desc(latest), asc(sets.exerciseId))
    .limit(limit)
  return rows.map((r) => r.exerciseId)
}
