import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { ApiError, Bodyweight, GroupMembership, WeighIn } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users, weighIns } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { create } from './service.ts'

/**
 * Weigh-ins (#42): one a day, another that day replacing it; read and written as athlete notes are
 * — by the athlete or a coach of theirs — and removed by whoever took one, or by the athlete. See
 * GLOSSARY.md, "Weigh-in".
 */

let h: TestApi
let coach: TestUser
let athlete: TestUser
let squadId: string

const send = async (user: TestUser, path: string, body?: unknown, method = 'POST') =>
  await user.wire(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

const ok = async (user: TestUser, path: string, body?: unknown, method = 'POST') => {
  const res = await send(user, path, body, method)
  if (res.status >= 300) throw new Error(`${method} ${path}: ${String(res.status)}`)
  return res.body
}

const share = async (user: TestUser, groupId: string, sharesTraining: boolean) =>
  await ok(user, `/groups/${groupId}/membership`, { sharesTraining }, 'PATCH')

const bodyweight = async (user: TestUser, path = '/weigh-ins', weeks = 8) =>
  expectContract(Bodyweight, (await user.wire(`${path}?weeks=${String(weeks)}`)).body)

const weigh = async (user: TestUser, path: string, day: string, weightG: number) =>
  expectContract(WeighIn, await ok(user, path, { day, weightG }))

/** `YYYY-MM-DD`, `days` before today in UTC. */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  h = await makeApi()
  coach = await h.as('coach')
  athlete = await h.as('athlete')
  squadId = expectContract(GroupMembership, await ok(coach, '/groups', { name: 'Squad' })).id
  await ok(coach, `/groups/${squadId}/members`, { username: athlete.username, role: 'reader' })
  await share(athlete, squadId, true)
})

const theirs = () => `/athletes/${athlete.userId}/weigh-ins`

describe('your own weigh-ins', () => {
  test('are none at first, then each taken, newest day first', async () => {
    expect(await bodyweight(athlete)).toEqual({ weighIns: [], before: null })
    const earlier = await weigh(athlete, '/weigh-ins', daysAgo(3), 83_000)
    const later = await weigh(athlete, '/weigh-ins', daysAgo(1), 82_400)
    expect(later).toMatchObject({
      day: daysAgo(1),
      weightG: 82_400,
      author: { id: athlete.userId },
      canDelete: true,
    })
    expect((await bodyweight(athlete)).weighIns.map((w) => w.id)).toEqual([later.id, earlier.id])
  })

  test('are one a day: another that day replaces it', async () => {
    await weigh(athlete, '/weigh-ins', daysAgo(0), 83_000)
    await weigh(athlete, '/weigh-ins', daysAgo(0), 82_600)
    const { weighIns: kept } = await bodyweight(athlete)
    expect(kept.map((w) => w.weightG)).toEqual([82_600])
  })

  test("are a period's, and the latest before it, which its change is from", async () => {
    await db.insert(weighIns).values(
      [
        [70, 86_000],
        [60, 85_000],
        [20, 84_000],
        [5, 83_000],
      ].map(([ago = 0, weightG = 0]) => ({
        athleteId: athlete.userId,
        authorId: athlete.userId,
        day: daysAgo(ago),
        weightG,
      })),
    )
    const period = await bodyweight(athlete, '/weigh-ins', 8)
    expect(period.weighIns.map((w) => w.weightG)).toEqual([83_000, 84_000])
    expect(period.before?.weightG).toBe(85_000)
  })

  test('are removed', async () => {
    const taken = await weigh(athlete, '/weigh-ins', daysAgo(0), 82_400)
    expect(await ok(athlete, `/weigh-ins/${taken.id}`, undefined, 'DELETE')).toEqual({ ok: true })
    expect((await bodyweight(athlete)).weighIns).toEqual([])
  })

  test('are yours: another person reads none, and removes none', async () => {
    const stranger = await h.as('stranger')
    const taken = await weigh(athlete, '/weigh-ins', daysAgo(0), 82_400)
    expect((await bodyweight(stranger)).weighIns).toEqual([])
    expect((await send(stranger, `/weigh-ins/${taken.id}`, undefined, 'DELETE')).status).toBe(404)
    expect((await bodyweight(athlete)).weighIns).toHaveLength(1)
  })

  test('refuse a weight past what a person weighs, a day to come, and anything more', async () => {
    for (const body of [
      { day: daysAgo(0), weightG: 19_999 },
      { day: daysAgo(0), weightG: 400_001 },
      { day: daysAgo(-2), weightG: 82_400 },
      { day: daysAgo(0), weightG: 82_400, note: 'after breakfast' },
    ]) {
      const refused = await send(athlete, '/weigh-ins', body)
      expect(refused.status).toBe(422)
      expectContract(ApiError, refused.body)
    }
    expect((await bodyweight(athlete)).weighIns).toEqual([])
  })

  /** Taken at once on one day, kept once: the unique day decides, not a read before the write. */
  test('taken at once on one day, kept once', async () => {
    await Promise.all(Array.from({ length: 30 }, async () => await db.execute(sql`select 1`)))
    await Promise.all(
      Array.from(
        { length: 30 },
        async (_, i) =>
          await create(athlete.caller, undefined, { day: daysAgo(0), weightG: 80_000 + i }),
      ),
    )
    expect((await bodyweight(athlete)).weighIns).toHaveLength(1)
  })
})

describe('a coach', () => {
  test('takes an athlete’s weigh-in, which the athlete reads under the coach’s name', async () => {
    const taken = await weigh(coach, theirs(), daysAgo(0), 82_400)
    expect(taken.canDelete).toBe(true)
    const [read] = (await bodyweight(athlete)).weighIns
    expect(read).toMatchObject({
      id: taken.id,
      author: { id: coach.userId, displayName: coach.caller.displayName },
      canDelete: true,
    })
  })

  test('reads the athlete’s own weigh-ins, and removes none of them', async () => {
    const own = await weigh(athlete, '/weigh-ins', daysAgo(0), 82_400)
    const [read] = (await bodyweight(coach, theirs())).weighIns
    expect(read).toMatchObject({ id: own.id, canDelete: false })
    expect((await send(coach, `${theirs()}/${own.id}`, undefined, 'DELETE')).status).toBe(404)
    expect((await bodyweight(athlete)).weighIns).toHaveLength(1)
  })

  test('replaces that day’s weigh-in, which is then the coach’s', async () => {
    await weigh(athlete, '/weigh-ins', daysAgo(0), 82_400)
    await weigh(coach, theirs(), daysAgo(0), 82_000)
    const [read] = (await bodyweight(athlete)).weighIns
    expect(read).toMatchObject({ weightG: 82_000, author: { id: coach.userId } })
  })

  test('reaches a weigh-in only through the athlete it is of', async () => {
    const other = await h.as('other')
    await ok(coach, `/groups/${squadId}/members`, { username: other.username, role: 'reader' })
    await share(other, squadId, true)
    const taken = await weigh(coach, theirs(), daysAgo(0), 82_400)
    const wrong = `/athletes/${other.userId}/weigh-ins/${taken.id}`
    expect((await send(coach, wrong, undefined, 'DELETE')).status).toBe(404)
    expect((await bodyweight(athlete)).weighIns).toHaveLength(1)
  })
})

describe('the athlete', () => {
  test('removes a coach’s weigh-in of them', async () => {
    const taken = await weigh(coach, theirs(), daysAgo(0), 82_400)
    await ok(athlete, `/weigh-ins/${taken.id}`, undefined, 'DELETE')
    expect((await bodyweight(coach, theirs())).weighIns).toEqual([])
  })

  test('keeps a coach’s weigh-ins when they stop sharing, and the coach reaches none', async () => {
    const taken = await weigh(coach, theirs(), daysAgo(0), 82_400)
    await share(athlete, squadId, false)
    expect((await bodyweight(athlete)).weighIns[0]?.id).toBe(taken.id)
    for (const [path, body, method] of [
      [`${theirs()}?weeks=8`, undefined, 'GET'],
      [theirs(), { day: daysAgo(0), weightG: 80_000 }, 'POST'],
      [`${theirs()}/${taken.id}`, undefined, 'DELETE'],
    ] as const) {
      expect((await send(coach, path, body, method)).status).toBe(404)
    }
  })

  test('reads a weigh-in whose taker’s account is gone as nobody’s', async () => {
    const taken = await weigh(coach, theirs(), daysAgo(0), 82_400)
    await db.delete(users).where(eq(users.id, coach.userId))
    expect((await bodyweight(athlete)).weighIns[0]).toMatchObject({ id: taken.id, author: null })
  })
})

describe('someone who is not shared with', () => {
  test('is told the same of an athlete as of nobody', async () => {
    const stranger = await h.as('stranger')
    const nobody = '00000000-0000-4000-8000-000000000000'
    const replies = await Promise.all(
      [athlete.userId, nobody].map(async (id) => {
        const res = await send(stranger, `/athletes/${id}/weigh-ins`, {
          day: daysAgo(0),
          weightG: 80_000,
        })
        return { status: res.status, body: res.body }
      }),
    )
    expect(replies[0]).toEqual(replies[1])
    expect(replies[0]?.status).toBe(404)
  })

  test('without signing in, is refused before the body is checked', async () => {
    for (const [path, method] of [
      ['/weigh-ins', 'GET'],
      ['/weigh-ins', 'POST'],
      [`/weigh-ins/${athlete.userId}`, 'DELETE'],
      [theirs(), 'GET'],
      [theirs(), 'POST'],
    ] as const) {
      const res = await h.wire(path, { method, body: method === 'GET' ? undefined : '{}' })
      expect(res.status).toBe(401)
    }
  })
})
