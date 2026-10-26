import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, Exercise } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const create = (equipment?: unknown) =>
  alice.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Landmine Press',
      equipment,
      muscles: [{ muscle: 'deltoid_anterior', loadPct: 100 }],
    }),
  })

const patch = (id: string, body: unknown) =>
  alice.wire(`/exercises/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

/** What an exercise needs (#33): items from the list, all of them — or nothing, or not said yet. */
describe("an exercise's equipment", () => {
  test('is kept as named, and read back the same', async () => {
    const made = expectContract(Exercise, (await create(['barbell', 'rack'])).body)
    expect(made.equipment).toEqual(['barbell', 'rack'])
    const read = expectContract(Exercise, (await alice.wire(`/exercises/${made.id}`)).body)
    expect(read.equipment).toEqual(['barbell', 'rack'])
  })

  test('left unsaid is undescribed; needing nothing is its own answer, and each can be undone', async () => {
    const made = expectContract(Exercise, (await create()).body)
    expect(made.equipment).toBeNull()

    const nothing = expectContract(Exercise, (await patch(made.id, { equipment: [] })).body)
    expect(nothing.equipment).toEqual([])
    const unsaid = expectContract(Exercise, (await patch(made.id, { equipment: null })).body)
    expect(unsaid.equipment).toBeNull()
  })

  test('a patch that names no equipment leaves it alone', async () => {
    const made = expectContract(Exercise, (await create(['dumbbells', 'flat_bench'])).body)
    const renamed = expectContract(Exercise, (await patch(made.id, { name: 'Renamed' })).body)
    expect(renamed.equipment).toEqual(['dumbbells', 'flat_bench'])
  })

  test('refuses what is not on the list, the load on two items, and a weight belt', async () => {
    for (const equipment of [['Barbell'], ['barbell', 'dumbbells'], ['weight_belt']]) {
      // oxlint-disable-next-line no-await-in-loop
      const refused = await create(equipment)
      expect(refused.status).toBe(422)
      expectContract(ApiError, refused.body)
    }
  })
})
