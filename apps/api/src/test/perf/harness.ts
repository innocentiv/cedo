import {
  PERF_TARGET_SET_LOGS,
  type PerfFixtures,
  loadPerfFixtures,
  seedPerf,
} from '../../db/seed-perf/index.ts'
import { ensureDatabaseExists } from '../../db/ensure.ts'

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

    const existing = await loadPerfFixtures()
    if (existing !== null) return existing

    console.log(
      `Seeding the performance database (${PERF_TARGET_SET_LOGS.toLocaleString('en')}+ set logs). ` +
        'This happens once; later runs reuse it.',
    )
    return await seedPerf()
  })()

  return await fixtures
}
