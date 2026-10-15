import { beforeEach, describe, expect, test } from 'bun:test'
import type { z } from 'zod'
import { Exercise, GroupMembership, Workout, WorkoutSummary, page } from '@cedo/contract'
import type { ExerciseRow, WorkoutRow } from '../../db/visible.ts'
import type { exerciseLifecycle } from '../exercise/lifecycle.ts'
import * as ExerciseService from '../exercise/service.ts'
import * as WorkoutService from '../workout/service.ts'
import type { workoutLifecycle } from '../workout/lifecycle.ts'
import type { Caller } from '../../plugins/auth.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * What every ownable does the same way — listing, searching, paging, favourites, transfer, access —
 * proven once and run against EACH kind. A behaviour tested only on `/exercises` was a behaviour
 * the workout copy of the same code could break unseen; here a third kind joins by adding one
 * entry to KINDS. Entity-specific behaviour (muscles, plans, the travel rule) stays in its module.
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

/** The part of an ownable every kind returns, read through each kind's own contract. */
interface Item {
  readonly id: string
  readonly name: string
  readonly ownerGroupId: string
  readonly canEdit: boolean
  readonly isFavourite: boolean
}

interface Kind {
  readonly path: '/exercises' | '/workouts'
  readonly body: (name: string) => Record<string, unknown>
  readonly one: z.ZodType<Item>
  readonly many: z.ZodType<{ items: Item[]; nextCursor: string | null }>
  /** The service function an MCP tool calls, bypassing the route's schema. */
  readonly listDirectly: (
    caller: Caller,
    query: { scope: 'group'; limit: number },
  ) => Promise<unknown>
}

const KINDS: readonly Kind[] = [
  {
    path: '/exercises',
    body: (name) => ({ name, muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
    one: Exercise,
    many: page(Exercise),
    listDirectly: async (caller, query) => await ExerciseService.list(caller, query),
  },
  {
    path: '/workouts',
    body: (name) => ({ name }),
    one: Workout,
    many: page(WorkoutSummary),
    listDirectly: async (caller, query) => await WorkoutService.list(caller, query),
  },
]

describe.each(KINDS)('$path', (kind) => {
  const create = async (user: TestUser, name = 'Thing'): Promise<Item> =>
    expectContract(
      kind.one,
      (await user.wire(kind.path, { method: 'POST', body: JSON.stringify(kind.body(name)) })).body,
    )
  const read = async (user: TestUser, id: string): Promise<Item> =>
    expectContract(kind.one, (await user.wire(`${kind.path}/${id}`)).body)
  const list = async (
    user: TestUser,
    query = '',
  ): Promise<{ items: Item[]; nextCursor: string | null }> =>
    expectContract(kind.many, (await user.wire(`${kind.path}?limit=100${query}`)).body)
  const names = async (user: TestUser, query = '') =>
    (await list(user, query)).items.map((i) => i.name)
  const post = async (user: TestUser, path: string, body: unknown = {}) =>
    await user.wire(path, { method: 'POST', body: JSON.stringify(body) })

  async function groupOf(owner: TestUser, member?: { user: TestUser; role: 'editor' | 'reader' }) {
    const group = expectContract(
      GroupMembership,
      (await post(owner, '/groups', { name: 'Squad' })).body,
    )
    if (member !== undefined) {
      await post(owner, `/groups/${group.id}/members`, {
        username: member.user.username,
        role: member.role,
      })
    }
    return group.id
  }

  async function inGroup(owner: TestUser, groupId: string, name: string): Promise<Item> {
    const item = await create(owner, name)
    await post(owner, `${kind.path}/${item.id}/transfer`, { toGroupId: groupId })
    return item
  }

  describe('access', () => {
    test("one user cannot see another's", async () => {
      const mine = await create(alice, 'Secret')
      expect((await bob.wire(`${kind.path}/${mine.id}`)).status).toBe(404)
      expect(await names(bob)).not.toContain('Secret')
    })

    test('hidden and nonexistent are indistinguishable', async () => {
      const mine = await create(alice, 'Secret')
      const hidden = await bob.wire(`${kind.path}/${mine.id}`)
      const missing = await bob.wire(`${kind.path}/${crypto.randomUUID()}`)
      expect(hidden.status).toBe(missing.status)
      expect(hidden.body).toEqual(missing.body)
    })

    test('a stranger cannot rename or delete, and the row is untouched', async () => {
      const mine = await create(alice, 'Secret')
      const patched = await bob.wire(`${kind.path}/${mine.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Hijacked' }),
      })
      expect(patched.status).toBe(404)
      expect((await bob.wire(`${kind.path}/${mine.id}`, { method: 'DELETE' })).status).toBe(404)
      expect((await read(alice, mine.id)).name).toBe('Secret')
    })

    test('a reader of the owning group can read but not edit', async () => {
      const squad = await groupOf(alice, { user: bob, role: 'reader' })
      const shared = await inGroup(alice, squad, 'Shared')

      expect((await read(bob, shared.id)).canEdit).toBe(false)
      const patched = await bob.wire(`${kind.path}/${shared.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Hijacked' }),
      })
      expect(patched.status).toBe(404)
    })

    test('a deleted one is gone', async () => {
      const mine = await create(alice)
      expect((await alice.wire(`${kind.path}/${mine.id}`, { method: 'DELETE' })).status).toBe(200)
      expect((await alice.wire(`${kind.path}/${mine.id}`)).status).toBe(404)
    })
  })

  describe('favourites', () => {
    test('pin and unpin, reflected in the row and in the favourites scope', async () => {
      const item = await create(alice, 'Pinned')
      expect(
        (await alice.wire(`${kind.path}/${item.id}/favourite`, { method: 'PUT' })).status,
      ).toBe(200)
      expect((await read(alice, item.id)).isFavourite).toBe(true)
      expect(await names(alice, '&scope=favourites')).toEqual(['Pinned'])

      expect(
        (await alice.wire(`${kind.path}/${item.id}/favourite`, { method: 'DELETE' })).status,
      ).toBe(200)
      expect((await read(alice, item.id)).isFavourite).toBe(false)
      expect(await names(alice, '&scope=favourites')).toEqual([])
    })

    test('pinning twice is idempotent', async () => {
      const item = await create(alice)
      await alice.wire(`${kind.path}/${item.id}/favourite`, { method: 'PUT' })
      expect(
        (await alice.wire(`${kind.path}/${item.id}/favourite`, { method: 'PUT' })).status,
      ).toBe(200)
    })

    test('a pin is per user', async () => {
      const squad = await groupOf(alice, { user: bob, role: 'reader' })
      const shared = await inGroup(alice, squad, 'Shared')
      await bob.wire(`${kind.path}/${shared.id}/favourite`, { method: 'PUT' })

      expect((await read(bob, shared.id)).isFavourite).toBe(true)
      expect((await read(alice, shared.id)).isFavourite).toBe(false)
    })

    test('cannot pin what you cannot see', async () => {
      const mine = await create(alice)
      expect((await bob.wire(`${kind.path}/${mine.id}/favourite`, { method: 'PUT' })).status).toBe(
        404,
      )
    })
  })

  describe('listing', () => {
    test('search matches a substring of the name', async () => {
      await create(alice, 'Barbell Bench')
      await create(alice, 'Cable Fly')
      expect(await names(alice, '&q=bench')).toEqual(['Barbell Bench'])
    })

    test('a literal % in a search matches only names containing it', async () => {
      await create(alice, '50% Effort')
      await create(alice, '50 Effort')
      expect(await names(alice, '&q=50%25')).toEqual(['50% Effort'])
    })

    test('a lone underscore in a search does not match everything', async () => {
      await create(alice, 'Plain')
      expect(await names(alice, '&q=_')).toEqual([])
    })

    test("scope=mine is the caller's personal group; scope=group is that group only", async () => {
      const squad = await groupOf(alice)
      await create(alice, 'Personal')
      await inGroup(alice, squad, 'In Squad')

      expect(await names(alice, '&scope=mine')).toEqual(['Personal'])
      expect(await names(alice, `&scope=group&groupId=${squad}`)).toEqual(['In Squad'])
      expect(await names(alice, '&scope=all')).toEqual(['In Squad', 'Personal'])
    })

    test('scope=group on a group you cannot reach is an empty page, not an error', async () => {
      const theirs = await groupOf(bob)
      await inGroup(bob, theirs, 'Theirs')
      const res = await alice.wire(`${kind.path}?scope=group&groupId=${theirs}`)
      expect(res.status).toBe(200)
      expect(expectContract(kind.many, res.body).items).toEqual([])
    })

    test('paginates by keyset without repeating or skipping rows', async () => {
      const all = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
      for (const name of all) await create(alice, name)

      const seen: string[] = []
      let cursor: string | null = null
      for (let guard = 0; guard < 10; guard++) {
        const after: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
        const res = await alice.wire(`${kind.path}?limit=2${after}`)
        const pageOf = expectContract(kind.many, res.body)
        seen.push(...pageOf.items.map((i) => i.name))
        cursor = pageOf.nextCursor
        if (cursor === null) break
      }
      expect(seen).toEqual(all)
    })

    test('a malformed cursor, or one whose id is not a uuid, is ignored rather than a 500', async () => {
      await create(alice)
      const notUuid = Buffer.from(JSON.stringify(['Thing', 'not-a-uuid'])).toString('base64url')
      expect((await alice.wire(`${kind.path}?cursor=not-a-real-cursor`)).status).toBe(200)
      expect((await alice.wire(`${kind.path}?cursor=${notUuid}`)).status).toBe(200)
    })

    /** The HTTP route is protected by the schema, but MCP tools call the service directly. */
    test("scope 'group' without a groupId is a validation error from the service", async () => {
      const outcome = await kind.listDirectly(alice.caller, { scope: 'group', limit: 50 }).then(
        () => '(nothing was thrown)',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
      expect(outcome).toMatch(/groupId is required/u)
    })
  })

  describe('transfer and duplicate', () => {
    test('transfer moves ownership and keeps it hidden from outsiders', async () => {
      const squad = await groupOf(alice)
      const mine = await create(alice, 'Moving')
      const res = await post(alice, `${kind.path}/${mine.id}/transfer`, { toGroupId: squad })
      const moved = expectContract(kind.one, res.body)

      expect(moved.ownerGroupId).toBe(squad)
      expect(moved.canEdit).toBe(true)
      expect((await bob.wire(`${kind.path}/${mine.id}`)).status).toBe(404)
    })

    test('needs editor rights on BOTH sides', async () => {
      const mine = await create(alice)
      // Into a group the caller cannot edit.
      const into = await post(alice, `${kind.path}/${mine.id}/transfer`, {
        toGroupId: bob.personalGroupId,
      })
      expect(into.status).toBe(404)

      // Out of a group the caller only reads.
      const squad = await groupOf(alice, { user: bob, role: 'reader' })
      const shared = await inGroup(alice, squad, 'Shared')
      const out = await post(bob, `${kind.path}/${shared.id}/transfer`, {
        toGroupId: bob.personalGroupId,
      })
      expect(out.status).toBe(404)
      expect((await read(alice, shared.id)).ownerGroupId).toBe(squad)
    })

    test('duplicate gives an editable copy, and refuses a group you cannot edit', async () => {
      const squad = await groupOf(alice, { user: bob, role: 'reader' })
      const shared = await inGroup(alice, squad, 'Shared')

      const copy = expectContract(
        kind.one,
        (await post(bob, `${kind.path}/${shared.id}/duplicate`)).body,
      )
      expect(copy.id).not.toBe(shared.id)
      expect(copy.ownerGroupId).toBe(bob.personalGroupId)
      expect(copy.canEdit).toBe(true)

      const refused = await post(bob, `${kind.path}/${shared.id}/duplicate`, { toGroupId: squad })
      expect(refused.status).toBe(404)
    })
  })
})

/**
 * Compile-time: a lifecycle hands back the kind's own row type. A favourites table typed by a plain
 * `string` name collapses every selected field to `never` — which assigns to anything, so only an
 * exact type equality catches it. Remove the `alias()` in `ownable/service.ts` and this stops
 * compiling.
 */
/** Mutual assignability, boxed so `never` is not vacuously equal to everything. */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type RowOf<TLifecycle extends { get: (...args: never[]) => Promise<{ row: unknown }> }> = Awaited<
  ReturnType<TLifecycle['get']>
>['row']

test("a lifecycle's rows are typed as its kind's", () => {
  const exerciseRow: Equal<RowOf<typeof exerciseLifecycle>, ExerciseRow> = true
  const workoutRow: Equal<RowOf<typeof workoutLifecycle>, WorkoutRow> = true
  expect([exerciseRow, workoutRow]).toEqual([true, true])
})
