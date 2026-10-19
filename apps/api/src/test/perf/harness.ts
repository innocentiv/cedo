import {
  PERF_TARGET_SET_LOGS,
  type PerfFixtures,
  loadPerfFixtures,
  seedPerf,
} from '../../db/seed-perf/index.ts'
import { ensureDatabaseExists } from '../../db/ensure.ts'
import { runMigrations } from '../../db/migrate.ts'

/**
 * The performance suite runs against its own database at production volume, seeded once and reused.
 * See docs/10-testing.md for what belongs here rather than in the integration tests.
 */

let fixtures: Promise<PerfFixtures> | undefined

export async function perfFixtures(): Promise<PerfFixtures> {
  fixtures ??= (async () => {
    if (Bun.env['CEDO_PERF'] === undefined) {
      throw new Error(
        'The performance suite must run with CEDO_PERF=1 so it uses its own database.\n' +
          'Run `bun run perf`, never `bun test` on these files.',
      )
    }
    await ensureDatabaseExists()

    /**
     * A THROWN load counts as "not seeded", not as a crash.
     *
     * The database can exist with no schema at all — `docker compose down -v` on the test stack
     * removes the volume — and the first query then fails on a missing table rather than returning
     * nothing. Treating that as a reason to reseed makes the suite self-healing; treating it as an
     * error made `bun run perf` unrunnable until someone worked out what had happened.
     */
    const existing = await loadPerfFixtures().catch(() => null)
    if (existing !== null) {
      /**
       * A reused database still gets the CURRENT schema. Without this, a migration that adds or
       * rebuilds an index — precisely what this suite exists to verify — was measured against the
       * old schema until someone remembered `perf:seed`, and the guard reported on an index that
       * no longer existed in the code. Migrations are idempotent, so this is a no-op when current.
       */
      await runMigrations()
      return existing
    }

    console.log(
      `Seeding the performance database (${PERF_TARGET_SET_LOGS.toLocaleString('en')}+ set logs). ` +
        'This happens once; later runs reuse it.',
    )
    return await seedPerf()
  })()

  return await fixtures
}
