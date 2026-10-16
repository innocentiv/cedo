import { beforeEach, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { exercises } from '../../db/schema.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { libraryAudit } from './curation.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

/**
 * Ids fixed so the scan pairs from the original's side (`b.id > a.id`): the original sorts first and
 * has the lowest id. The lookalikes come before the duplicate both by name and by insertion order,
 * so a scan that stops after a few matches meets them first whichever index it walks.
 */
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

/**
 * Regression: the duplicate scan matched with `%` at pg_trgm's DEFAULT threshold, 0.3, kept only
 * the first five matches per exercise, and only then dropped those below 0.55. Lookalikes in the
 * 0.3–0.55 band ahead of a true duplicate used up the five, and the duplicate the audit exists to
 * find was never reported — a third of the pairs on the perf library. Seven lookalikes, so any
 * per-candidate cap below eight still reproduces it.
 */
test('a true duplicate is found even behind merely similar names', async () => {
  const lookalikes = [
    'Cable Lateral Bentover Row',
    'Cable Lateral Deadlift',
    'Cable Lateral Good Morning',
    'Cable Lateral Halo Twist',
    'Cable Lateral Kneeling Chop',
    'Cable Lateral Monster Walk',
    'Cable Lateral Pulldown',
  ]
  const names = ['Cable Lateral Raise', ...lookalikes, 'Cable Lateral Raises']
  await db.insert(exercises).values(
    names.map((name, i) => ({
      id: id(i === names.length - 1 ? 0xff : i + 1),
      name,
      ownerGroupId: alice.personalGroupId,
      createdBy: alice.userId,
    })),
  )

  // The setup is what it claims: every lookalike is a `%` match at 0.3 and below the bar.
  const scores = await db.execute<{ score: number }>(
    sql`select similarity('Cable Lateral Raise', n) as score
          from unnest(array[${sql.join(
            lookalikes.map((n) => sql`${n}`),
            sql`, `,
          )}]::text[]) n`,
  )
  for (const { score } of scores) {
    expect(score).toBeGreaterThan(0.3)
    expect(score).toBeLessThan(0.55)
  }

  const audit = await libraryAudit(alice.caller, alice.personalGroupId)
  expect(audit.possibleDuplicates.map((d) => [d.a, d.b])).toContainEqual([
    'Cable Lateral Raise',
    'Cable Lateral Raises',
  ])
})
