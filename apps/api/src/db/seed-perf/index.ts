import { sql } from 'drizzle-orm'
import { DEFAULT_GROUP_SLUG } from '@cedo/contract'
import { closeDatabase, db } from '../client.ts'
import { ensureDatabaseExists } from '../ensure.ts'
import { seedMuscles } from '../seed.ts'
import { runMigrations } from '../migrate.ts'
import { PERF_TARGET_SET_LOGS, type PerfFixtures, countRows, scalar } from './shape.ts'
import {
  seedBackgroundSessions,
  seedBackgroundUsers,
  seedBackgroundWorkouts,
  seedFavourites,
  seedMedia,
  seedSharedGroup,
  seedSharedLibrary,
  seedTokens,
  truncateAll,
} from './volume.ts'
import { loadProfile, seedProfile } from './profile.ts'
import { loadCurator, seedCuratedLibrary } from './curated.ts'

/**
 * A realistic-volume database, for `bun run perf` only.
 *
 * Missing indexes and accidental N+1s are invisible at development volumes — a sequential scan over
 * 500 rows takes microseconds, every test passes, and the problem first appears on a stranger's
 * NAS. This seed exists so the performance suite measures the plans real users get.
 * See docs/10-testing.md.
 *
 * EVERY VALUE IS DERIVED ARITHMETICALLY from a row number. No randomness, not even a seeded PRNG:
 * the same command produces byte-identical data, so a query plan that changed between two runs
 * changed because the code changed.
 *
 * Written as bulk `insert ... select ... from generate_series` rather than ORM value lists, which
 * would take minutes for a quarter of a million rows. This is the one file where raw SQL is the
 * right tool; everything the application itself runs goes through Drizzle.
 */

export { PERF_TARGET_SET_LOGS, PERF_VOLUME } from './shape.ts'
export type { PerfFixtures, PerfProfile } from './shape.ts'

export async function seedPerf(): Promise<PerfFixtures> {
  await ensureDatabaseExists()
  await runMigrations()
  await truncateAll()
  await seedMuscles()

  const sharedGroupId = await seedSharedGroup()
  const systemUserId = await seedBackgroundUsers(sharedGroupId)
  await seedSharedLibrary(sharedGroupId, systemUserId)
  await seedBackgroundWorkouts(sharedGroupId, systemUserId)
  await seedMedia(sharedGroupId, systemUserId)
  await seedTokens()
  await seedBackgroundSessions(sharedGroupId)

  const small = await seedProfile('small', sharedGroupId)
  const large = await seedProfile('large', sharedGroupId)
  // After the profiles, so the users the hot paths run as have pins too: an empty favourites
  // join is solved for free and proves nothing.
  await seedFavourites(sharedGroupId)
  const curator = await seedCuratedLibrary()

  // Without fresh statistics the planner works from defaults and chooses plans nobody in
  // production would get, which would make every assertion below meaningless.
  await db.execute(sql`analyze`)

  return { small, large, sharedGroupId, curator, setLogCount: await countRows('set_logs') }
}

/**
 * Reads the fixtures back without rewriting anything, so a second `bun run perf` starts measuring
 * in about a second instead of rebuilding a quarter of a million rows.
 */
export async function loadPerfFixtures(): Promise<PerfFixtures | null> {
  const sharedGroupId = await scalar(
    sql`select id::text from groups where slug = ${DEFAULT_GROUP_SLUG}`,
  )
  if (sharedGroupId === null) return null

  const setLogCount = await countRows('set_logs')
  if (setLogCount < PERF_TARGET_SET_LOGS) return null

  const small = await loadProfile('small')
  const large = await loadProfile('large')
  const curator = await loadCurator()
  if (small === null || large === null || curator === null) return null

  return { small, large, sharedGroupId, curator, setLogCount }
}

if (import.meta.main) {
  const started = Bun.nanoseconds()
  const fixtures = await seedPerf()
  const seconds = ((Bun.nanoseconds() - started) / 1e9).toFixed(1)
  console.log(
    `Seeded ${fixtures.setLogCount.toLocaleString('en')} set logs in ${seconds}s ` +
      `(profiles: ${fixtures.small.caller.username}, ${fixtures.large.caller.username}).`,
  )
  await closeDatabase()
}
