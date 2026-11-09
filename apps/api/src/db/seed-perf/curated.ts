import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import { type Caller } from '../../plugins/auth.ts'
import { UNUSABLE_HASH, required, scalar } from './shape.ts'
import { callerFor } from './profile.ts'

/**
 * A second library, named the way a real one is — for the library audit, and nothing else.
 *
 * The shared library's names are `Equipment Movement N`: every name has dozens of near-identical
 * siblings. That is the BEST case for a duplicate scan that walks the library in name order and
 * stops at five matches, and the worst stand-in for a curated library, where most names are
 * distinct and a few are genuine duplicates. Measured on the shared library alone, the audit's
 * `%` threshold looked like a 25% saving; on names shaped like these it halves the scan.
 *
 * So: 10,000 names of three words drawn from a 400-word vocabulary — words that share trigrams
 * the way real words do, without repeating each other's shape — and one planted near-duplicate for
 * every fiftieth, which the audit must find. Owned by a user nobody else shares a group with, so
 * it changes nothing any other hot path can see. Deterministic, like the rest of this seed.
 */
const CURATED = { exercises: 10_000, words: 400, duplicateEvery: 50 } as const
const USERNAME = 'perf_curator'

const word = (salt: string) =>
  `(select substr(md5(k::text), 1, 4 + k % 5) from generate_series(1, ${CURATED.words}) k
     where k = 1 + abs(hashtext(i::text || '${salt}')) % ${CURATED.words})`

export async function seedCuratedLibrary(): Promise<Caller> {
  const groupId = await required(
    sql`insert into groups (slug, name, kind) values (${USERNAME}, ${USERNAME}, 'personal')
        returning id::text`,
    `the ${USERNAME} group`,
  )
  const userId = await required(
    sql`insert into users (username, password_hash, display_name, personal_group_id)
        values (${USERNAME}, ${UNUSABLE_HASH}, ${USERNAME}, ${groupId}::uuid)
        returning id::text`,
    USERNAME,
  )
  await db.execute(sql`
    insert into group_members (group_id, user_id, role) values (${groupId}::uuid, ${userId}::uuid, 'editor')
  `)

  await db.execute(
    sql.raw(`
      with named as (
        select i, ${word('a')} || ' ' || ${word('b')} || ' ' || ${word('c')} || ' ' || i as name
          from generate_series(1, ${CURATED.exercises}) i
      )
      insert into exercises (owner_group_id, created_by, name, description, instructions)
      select '${groupId}'::uuid, '${userId}'::uuid, name, 'Seeded for the audit.', ''
        from named
      union all
      select '${groupId}'::uuid, '${userId}'::uuid, name || ' v2', 'A planted duplicate.', ''
        from named where i % ${CURATED.duplicateEvery} = 0
    `),
  )

  return await callerFor(userId)
}

export async function loadCurator(): Promise<Caller | null> {
  const userId = await scalar(sql`select id::text from users where username = ${USERNAME}`)
  return userId === null ? null : await callerFor(userId)
}
