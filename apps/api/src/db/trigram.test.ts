import { expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client.ts'
import { makeApi } from '../test/harness.ts'

/**
 * The exercise name's trigram index writes every entry straight in. GIN's default (`fastupdate`)
 * parks new entries in a pending list that EVERY lookup scans linearly until a vacuum flushes it —
 * and on a library grown in bulk (an AI creating hundreds of exercises over MCP) that can sit there
 * indefinitely below the 4 MB that forces a flush: the perf database's curated library left 257
 * pages, and every name search and library audit took 5s instead of 0.3s. Exercises are written
 * rarely and searched constantly, so the index pays at write time instead.
 */
test('the trigram index has no pending list for a search to scan', async () => {
  await makeApi()
  const [index] = await db.execute<{ options: string[] | null }>(
    sql`select reloptions as options from pg_class where relname = 'exercises_name_trgm_idx'`,
  )
  // Stored as written: `fastupdate=false` or `fastupdate=off`, both meaning no pending list.
  expect(index?.options?.some((o) => /^fastupdate=(off|false)$/u.test(o))).toBe(true)
})
