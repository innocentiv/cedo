import { describe, expect, test } from 'bun:test'
import { HOT_PATHS, type Measurement, measure } from './hot-paths.ts'
import { perfFixtures } from './harness.ts'
import { expectIndexUsed, expectNoSeqScan, explain, planSummary } from '../explain.ts'
import { withQueryCount } from '../../db/client.ts'
import * as exerciseService from '../../modules/exercise/service.ts'

/**
 * The performance gate. Run with `bun run perf`, never with `bun test` — it needs its own
 * database at production volume. See docs/10-testing.md.
 *
 * Three kinds of assertion, in decreasing order of how much they are worth:
 *
 *  1. The query count is IDENTICAL at two volumes. This is a structural property: it holds or it
 *     does not, on any machine, and it is what actually catches an N+1.
 *  2. The plan uses the indexes it is supposed to and scans nothing sequentially. An index that
 *     exists but that the planner rejects looks identical in the schema and identical in a fast
 *     test on 500 rows.
 *  3. The slowest statement is under a budget. Weakest of the three — it is machine dependent, so
 *     the budgets are ceilings that catch a dropped index, not targets.
 */

const fixtures = await perfFixtures()

/** Measured once per path; all four assertions read the same measurement. */
const measured = new Map<string, Measurement>()
for (const path of HOT_PATHS) {
  // Sequential on purpose: concurrent measurements contend for the same connections, and a query
  // count recorded while another path is running would not be that path's count.
  // oxlint-disable-next-line no-await-in-loop
  measured.set(path.name, await measure(path, fixtures))
}

function measurementFor(name: string): Measurement {
  const found = measured.get(name)
  if (found === undefined) throw new Error(`No measurement for ${name}`)
  return found
}

test('the fixtures are at production volume', () => {
  // Guards against a half-built database quietly making every assertion below trivial.
  expect(fixtures.setLogCount).toBeGreaterThanOrEqual(250_000)
})

for (const path of HOT_PATHS) {
  describe(path.name, () => {
    test(`issues the same number of queries regardless of ${path.dimension}`, () => {
      const m = measurementFor(path.name)
      expect(
        m.largeCount,
        `${path.name} issued ${m.smallCount} queries at the small volume and ${m.largeCount} at ` +
          `the large one, varying ${path.dimension}. That difference IS the N+1.\n` +
          m.statements.map((s) => s.sql.replaceAll(/\s+/gu, ' ').slice(0, 160)).join('\n'),
      ).toBe(m.smallCount)
    })

    test(`issues at most ${path.maxQueries} queries`, () => {
      const m = measurementFor(path.name)
      expect(m.largeCount).toBeLessThanOrEqual(path.maxQueries)
    })

    if (path.noSeqScan.length > 0) {
      test('scans no large table sequentially', () => {
        const m = measurementFor(path.name)
        for (const plan of m.plans) for (const table of path.noSeqScan) expectNoSeqScan(plan, table)
      })
    }

    if (path.indexes.length > 0) {
      test(`uses ${path.indexes.join(', ')}`, () => {
        const m = measurementFor(path.name)
        for (const index of path.indexes) {
          const used = m.plans.some((plan) => planSummary(plan).includes(`using ${index}`))
          expect(
            used,
            `No statement used "${index}":\n${m.plans.map(planSummary).join('\n\n')}`,
          ).toBe(true)
        }
      })
    }

    test(`stays under ${path.budgetMs}ms`, () => {
      const m = measurementFor(path.name)
      expect(m.slowestMs).toBeLessThanOrEqual(path.budgetMs)
    })
  })
}

/**
 * Two indexes have no assertion in the table above, because on the COMMON case the planner
 * correctly prefers an ordered walk it can stop early. These are the cases where each must earn its
 * place — and both were invisible until the seed stopped spreading its data uniformly.
 */
test('a selective search uses the trigram index', async () => {
  const { statements } = await withQueryCount(
    async () =>
      await exerciseService.list(fixtures.large.caller, {
        scope: 'all',
        q: 'Kettlebell Pulldown 99',
        limit: 20,
      }),
  )
  const first = statements[0]
  expect(first).toBeDefined()
  if (first === undefined) return

  const plan = await explain(first)
  expectIndexUsed(plan, 'exercises_name_trgm_idx')
  expectNoSeqScan(plan, 'exercises')
})

test('a rare muscle filter enters through the muscle index', async () => {
  // The seeded library is skewed like a real one: hundreds of chest movements, a handful for the
  // adductors. On a common muscle Postgres walks exercises in name order and stops at the page
  // size; on a rare one the cheap plan is to read the 68 matching rows and join back by primary
  // key. Uniform seed data never produced the second case, which made the index look dead.
  const { statements } = await withQueryCount(
    async () =>
      await exerciseService.list(fixtures.large.caller, {
        scope: 'all',
        muscle: 'adductors',
        limit: 20,
      }),
  )
  const first = statements[0]
  expect(first).toBeDefined()
  if (first === undefined) return

  const plan = await explain(first)
  expectIndexUsed(plan, 'exercise_muscles_muscle_idx')
  expectNoSeqScan(plan, 'exercise_muscles')
})
