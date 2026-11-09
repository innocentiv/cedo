import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import { scalar } from './shape.ts'

/**
 * The one thing that says the perf database holds a whole seed — and WHICH seed.
 *
 * Written as the seed's LAST step, and removed as its first. Without it, a seed interrupted after
 * the curator was created but before its library — or before the final VACUUM ANALYZE — was reused
 * as if complete, and the suite blamed the plans: an audit over an empty library "did not use the
 * trigram index", a read "scanned sequentially" for want of statistics.
 *
 * It records a hash of everything the seed is made from, compared on reuse — so a change to the
 * seed, the muscles it seeds, or the schema it seeds into rebuilds the database on the next run,
 * rather than measuring the plans the old data gets. A hand-bumped version number would be the one
 * edit nobody remembers; the database was dropped by hand three times for want of this.
 */

const COMPLETED = sql.identifier('perf_seed_completed')

export async function clearMarker(): Promise<void> {
  await db.execute(sql`drop table if exists ${COMPLETED}`)
}

export async function markSeeded(): Promise<void> {
  await db.execute(
    sql`create table ${COMPLETED} as select now() as completed_at, ${await seedVersion()}::text as seed_version`,
  )
}

/**
 * Whether THIS seed, finished, built the database. Throws when there is no marker, or one written
 * before markers carried a version — both of which the caller treats as "not seeded".
 */
export async function seededByThisSeed(): Promise<boolean> {
  const built = await scalar(sql`select seed_version from ${COMPLETED}`)
  return built !== null && built === (await seedVersion())
}

const ROOT = resolve(import.meta.dir, '../../../../..')

/** What the seed is built from: its own files, the muscles, and the migrations. */
const SOURCES = [
  'apps/api/src/db/seed-perf/*.ts',
  'apps/api/src/db/seed.ts',
  'packages/contract/src/muscle.ts',
  'apps/api/drizzle/*.sql',
] as const

/** The files `SOURCES` names, tests left out, in a stable order. */
export async function seedSources(): Promise<string[]> {
  const found = await Promise.all(
    SOURCES.map(async (pattern) => await Array.fromAsync(new Bun.Glob(pattern).scan(ROOT))),
  )
  return found
    .flat()
    .filter((path) => !path.endsWith('.test.ts'))
    .toSorted()
}

/**
 * A hash over each file's path and contents, in order: a rename, an edit or a new file each change
 * it. Each content is length-prefixed, so no two different sets of files hash alike.
 */
export async function versionOf(paths: readonly string[], root = ROOT): Promise<string> {
  const contents = await Promise.all(
    paths.map(async (path) => await Bun.file(join(root, path)).text()),
  )
  const hash = createHash('sha256')
  paths.forEach((path, i) => {
    const content = contents[i] ?? ''
    hash.update(`${path}\0${content.length}\0${content}`)
  })
  return hash.digest('hex')
}

async function seedVersion(): Promise<string> {
  return await versionOf(await seedSources())
}
