import { expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from './client.ts'
import { makeApi } from '../test/harness.ts'

/**
 * Every GIN index writes its entries straight in (`fastupdate = off`). GIN's default parks new
 * entries in a pending list that EVERY lookup scans linearly until a vacuum flushes it — below the
 * 4 MB that forces a flush, indefinitely — and a bulk import of exercises left name search at 5s
 * instead of 0.3s. Every GIN index, not one by name, so the next one cannot ship without it. See
 * docs/05-database.md.
 */
test('no GIN index keeps a pending list for a lookup to scan', async () => {
  await makeApi()
  const indexes = await db.execute<{ name: string; options: string[] | null }>(sql`
    select c.relname as name, c.reloptions as options
      from pg_class c
      join pg_am am on am.oid = c.relam
     where am.amname = 'gin' and c.relkind = 'i'
  `)
  // At least the trigram index, or this would pass by finding nothing.
  expect(indexes.map((i) => i.name)).toContain('exercises_name_trgm_idx')
  const pending = indexes.filter(
    (i) => !(i.options ?? []).some((o) => /^fastupdate=(off|false)$/u.test(o)),
  )
  expect(pending.map((i) => i.name)).toEqual([])
})
