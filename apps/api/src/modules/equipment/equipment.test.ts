import { beforeEach, describe, expect, test } from 'bun:test'
import { ApiError, AthleteEquipment, GroupMembership } from '@cedo/contract'
import { replace } from './service.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const dumbbells = { stepG: 2000, minG: 2000, maxG: 30_000 }

const mine = async (user: TestUser = alice) =>
  expectContract(AthleteEquipment, (await user.wire('/equipment')).body)

const say = (items: unknown, user: TestUser = alice) =>
  user.wire('/equipment', { method: 'PUT', body: JSON.stringify({ items }) })

/** What an athlete has to train with (#34): said whole, and read back as said. */
describe('your equipment', () => {
  test('is undescribed until you say, which having nothing at all is not', async () => {
    expect(await mine()).toEqual({ described: false, items: [] })
    expect((await say([])).status).toBe(200)
    expect(await mine()).toEqual({ described: true, items: [] })
  })

  test('is read back as said, weights in grams, in the list’s order', async () => {
    await say([
      { slug: 'rack', weights: null },
      { slug: 'dumbbells', weights: dumbbells },
      { slug: 'barbell', weights: { stepG: 2500, minG: 20_000, maxG: null } },
      { slug: 'leg_press', weights: null },
    ])
    expect((await mine()).items).toEqual([
      { slug: 'dumbbells', weights: dumbbells },
      { slug: 'barbell', weights: { stepG: 2500, minG: 20_000, maxG: null } },
      { slug: 'rack', weights: null },
      { slug: 'leg_press', weights: null },
    ])
  })

  test('saying it again replaces it whole', async () => {
    await say([
      { slug: 'dumbbells', weights: dumbbells },
      { slug: 'rack', weights: null },
    ])
    await say([{ slug: 'kettlebells', weights: null }])
    expect((await mine()).items).toEqual([{ slug: 'kettlebells', weights: null }])
  })

  test('is yours: another person reads their own, and changes none of yours', async () => {
    const bob = await h.as('bob')
    await say([{ slug: 'dumbbells', weights: dumbbells }])
    expect(await mine(bob)).toEqual({ described: false, items: [] })
    await say([], bob)
    expect((await mine()).items).toHaveLength(1)
  })

  test('refuses an item twice, weights on a rack, and a heaviest below the lightest', async () => {
    for (const items of [
      [
        { slug: 'rack', weights: null },
        { slug: 'rack', weights: null },
      ],
      [{ slug: 'rack', weights: dumbbells }],
      [{ slug: 'dumbbells', weights: { ...dumbbells, maxG: 1000 } }],
      [{ slug: 'smith', weights: null }],
    ]) {
      const refused = await say(items)
      expect(refused.status).toBe(422)
      expectContract(ApiError, refused.body)
    }
    expect(await mine()).toEqual({ described: false, items: [] })
  })

  /** Two saves at once take turns: without the lock, both delete and both insert one key. */
  test('two saves at once both succeed, and the later stands', async () => {
    const saves = Array.from({ length: 12 }, (_, i) =>
      replace(alice.caller, {
        items: [
          { slug: 'dumbbells', weights: { ...dumbbells, maxG: 30_000 + i * 1000 } },
          { slug: 'rack', weights: null },
        ],
      }),
    )
    const results = await Promise.allSettled(saves)
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    expect((await mine()).items).toHaveLength(2)
  })
})

describe("an athlete's equipment, read by their coach", () => {
  test('while they share their training — read only', async () => {
    const coach = await h.as('coach')
    const squad = expectContract(
      GroupMembership,
      (await coach.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    await coach.wire(`/groups/${squad.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ username: alice.username, role: 'reader' }),
    })
    await say([{ slug: 'dumbbells', weights: dumbbells }])

    const path = `/athletes/${alice.userId}/equipment`
    expect((await coach.wire(path)).status).toBe(404)
    await alice.wire(`/groups/${squad.id}/membership`, {
      method: 'PATCH',
      body: JSON.stringify({ sharesTraining: true }),
    })
    const read = expectContract(AthleteEquipment, (await coach.wire(path)).body)
    expect(read.items).toEqual([{ slug: 'dumbbells', weights: dumbbells }])
    expect((await coach.wire(path, { method: 'PUT', body: '{"items":[]}' })).status).toBe(404)
  })
})
