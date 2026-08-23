import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, page } from '@cedo/contract'
import { withQueryCount } from '../../db/client.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import * as ExerciseService from './service.ts'

const Page = page(Exercise)

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

async function seedExercises(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    // oxlint-disable-next-line no-await-in-loop
    await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify({
        name: `Lift ${String(i).padStart(4, '0')}`,
        muscles: [
          { muscle: 'pectoralis_major', loadPct: 60 },
          { muscle: 'triceps_brachii', loadPct: 40 },
        ],
      }),
    })
  }
}

/**
 * N+1 detection by INVARIANT, not by a guessed threshold: the same call must issue the SAME number
 * of queries whatever the page size. An N+1 is by definition a count that grows with the rows, so
 * comparing two very different sizes detects it structurally.
 *
 * This is the cheap in-suite version of the guard; `bun run perf` runs it against a large seed.
 * See docs/adr/0018-n1-detection.md.
 */
describe('reads do not N+1', () => {
  test('listing issues the same number of queries for 1 exercise as for 30', async () => {
    await seedExercises(1)
    const small = await withQueryCount(() =>
      ExerciseService.list(alice.caller, { limit: 50, scope: 'all' }),
    )

    await seedExercises(29)
    const large = await withQueryCount(() =>
      ExerciseService.list(alice.caller, { limit: 50, scope: 'all' }),
    )

    expect(small.result.items).toHaveLength(1)
    expect(large.result.items).toHaveLength(30)
    expect(large.count).toBe(small.count)
    // Exercises, muscles, media. If this ever needs raising, something began fanning out.
    expect(large.count).toBeLessThanOrEqual(3)
  })

  test('a single fetch costs a fixed number of queries too', async () => {
    await seedExercises(1)
    const listed = expectContract(Page, (await alice.wire('/exercises')).body)
    const id = listed.items[0]?.id
    if (id === undefined) throw new Error('seeding produced no exercise')

    const { count } = await withQueryCount(() => ExerciseService.get(alice.caller, id))
    expect(count).toBeLessThanOrEqual(3)
  })

  test('the muscle filter does not add a query per row', async () => {
    await seedExercises(20)
    const filtered = await withQueryCount(() =>
      ExerciseService.list(alice.caller, { limit: 50, scope: 'all', muscle: 'triceps_brachii' }),
    )
    expect(filtered.result.items).toHaveLength(20)
    expect(filtered.count).toBeLessThanOrEqual(3)
  })
})
