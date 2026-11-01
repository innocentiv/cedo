import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { AthleteNote, Bodyweight, type RecordAuthorship, WeighIn } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { users } from '../../db/schema.ts'
import { anotherAthlete, coachedSquad, ok, send, share } from '../../test/coaching.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * Athlete records (GLOSSARY.md): what every kind keeps alike, once for each kind — read by the person
 * and whoever reads their training, written by either, removed by whoever wrote it or the person it
 * is about, and reached by no one else. What is a kind's own is in its module's tests.
 */

type Read = RecordAuthorship & { readonly id: string }

interface Kind {
  readonly name: string
  /** Yours: `/notes`. */
  readonly own: string
  /** An athlete's you coach: `/athletes/:id/notes`. */
  readonly of: (athleteId: string) => string
  readonly read: (user: TestUser, path: string) => Promise<readonly Read[]>
  /** One written at `path`; a higher `n` is a newer one. */
  readonly write: (user: TestUser, path: string, n: number) => Promise<Read>
  /** One that may be written, for the routes refused before or without it. */
  readonly body: unknown
}

/** `YYYY-MM-DD`, `days` before today in UTC. */
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

const KINDS: readonly Kind[] = [
  {
    name: 'athlete notes',
    own: '/notes',
    of: (id) => `/athletes/${id}/notes`,
    read: async (user, path) => expectContract(z.array(AthleteNote), (await user.wire(path)).body),
    write: async (user, path, n) =>
      expectContract(AthleteNote, await ok(user, path, { text: `Note ${String(n)}` })),
    body: { text: 'x' },
  },
  {
    name: 'weigh-ins',
    own: '/weigh-ins',
    of: (id) => `/athletes/${id}/weigh-ins`,
    read: async (user, path) =>
      expectContract(Bodyweight, (await user.wire(`${path}?weeks=8`)).body).weighIns,
    write: async (user, path, n) =>
      expectContract(WeighIn, await ok(user, path, { day: daysAgo(10 - n), weightG: 80_000 + n })),
    body: { day: daysAgo(0), weightG: 80_000 },
  },
]

let h: TestApi
let coach: TestUser
let athlete: TestUser
let squadId: string

beforeEach(async () => {
  h = await makeApi()
  ;({ coach, athlete, squadId } = await coachedSquad(h))
})

describe.each(KINDS)('$name', (kind) => {
  const theirs = () => kind.of(athlete.userId)
  const ids = async (user: TestUser, path: string) => (await kind.read(user, path)).map((r) => r.id)

  describe('your own', () => {
    test('are none at first, then each written, newest first, by you', async () => {
      expect(await kind.read(athlete, kind.own)).toEqual([])
      const first = await kind.write(athlete, kind.own, 1)
      const second = await kind.write(athlete, kind.own, 2)
      expect(second).toMatchObject({ author: { id: athlete.userId }, canDelete: true })
      expect(await ids(athlete, kind.own)).toEqual([second.id, first.id])
    })

    test('are removed by you', async () => {
      const kept = await kind.write(athlete, kind.own, 1)
      expect(await ok(athlete, `${kind.own}/${kept.id}`, undefined, 'DELETE')).toEqual({
        ok: true,
      })
      expect(await kind.read(athlete, kind.own)).toEqual([])
    })

    test('are yours: another person reads none, and removes none', async () => {
      const stranger = await h.as('stranger')
      const kept = await kind.write(athlete, kind.own, 1)
      expect(await kind.read(stranger, kind.own)).toEqual([])
      const removed = await send(stranger, `${kind.own}/${kept.id}`, undefined, 'DELETE')
      expect(removed.status).toBe(404)
      expect(await ids(athlete, kind.own)).toEqual([kept.id])
    })
  })

  describe('a coach', () => {
    test('writes one of an athlete, which the athlete reads under the coach’s name', async () => {
      const written = await kind.write(coach, theirs(), 1)
      expect(written.canDelete).toBe(true)
      const [read] = await kind.read(athlete, kind.own)
      expect(read).toMatchObject({
        id: written.id,
        author: { id: coach.userId, displayName: coach.caller.displayName },
        canDelete: true,
      })
    })

    test('removes one they wrote of an athlete', async () => {
      const written = await kind.write(coach, theirs(), 1)
      expect(await ok(coach, `${theirs()}/${written.id}`, undefined, 'DELETE')).toEqual({
        ok: true,
      })
      expect(await kind.read(athlete, kind.own)).toEqual([])
    })

    test('reads the athlete’s own, and removes none of them', async () => {
      const own = await kind.write(athlete, kind.own, 1)
      const [read] = await kind.read(coach, theirs())
      expect(read).toMatchObject({ id: own.id, canDelete: false })
      expect((await send(coach, `${theirs()}/${own.id}`, undefined, 'DELETE')).status).toBe(404)
      expect(await ids(athlete, kind.own)).toEqual([own.id])
    })

    test('another coach of theirs reads one, and removes none of it', async () => {
      const other = await h.as('other')
      await ok(coach, `/groups/${squadId}/members`, { username: other.username, role: 'editor' })
      const written = await kind.write(coach, theirs(), 1)
      const [read] = await kind.read(other, theirs())
      expect(read).toMatchObject({ id: written.id, canDelete: false })
      expect((await send(other, `${theirs()}/${written.id}`, undefined, 'DELETE')).status).toBe(404)
    })

    test('reaches one only through the athlete it is about', async () => {
      const other = await anotherAthlete(h, coach, squadId)
      const written = await kind.write(coach, theirs(), 1)
      const wrong = `${kind.of(other.userId)}/${written.id}`
      expect((await send(coach, wrong, undefined, 'DELETE')).status).toBe(404)
      expect(await ids(athlete, kind.own)).toEqual([written.id])
    })
  })

  describe('the athlete', () => {
    test('removes a coach’s one about them', async () => {
      const written = await kind.write(coach, theirs(), 1)
      await ok(athlete, `${kind.own}/${written.id}`, undefined, 'DELETE')
      expect(await kind.read(coach, theirs())).toEqual([])
    })

    test('keeps a coach’s when they stop sharing, and the coach reaches none', async () => {
      const written = await kind.write(coach, theirs(), 1)
      await share(athlete, squadId, false)
      expect(await ids(athlete, kind.own)).toEqual([written.id])
      expect((await send(coach, `${theirs()}?weeks=8`, undefined, 'GET')).status).toBe(404)
      expect((await send(coach, theirs(), kind.body)).status).toBe(404)
      const removed = await send(coach, `${theirs()}/${written.id}`, undefined, 'DELETE')
      expect(removed.status).toBe(404)
    })

    test('reads one whose author’s account is gone as no one’s', async () => {
      const written = await kind.write(coach, theirs(), 1)
      await db.delete(users).where(eq(users.id, coach.userId))
      const [read] = await kind.read(athlete, kind.own)
      expect(read).toMatchObject({ id: written.id, author: null, canDelete: true })
    })
  })

  describe('someone not shared with', () => {
    test('is told the same of an athlete as of nobody, on every route', async () => {
      const stranger = await h.as('stranger')
      const nobody = '00000000-0000-4000-8000-000000000000'
      const written = await kind.write(coach, theirs(), 1)
      for (const [route, body, method] of [
        ['', undefined, 'GET'],
        ['', kind.body, 'POST'],
        [`/${written.id}`, undefined, 'DELETE'],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- one route at a time, each compared.
        const [real, none] = await Promise.all(
          [athlete.userId, nobody].map(async (id) => {
            const res = await send(stranger, `${kind.of(id)}${route}`, body, method)
            return { status: res.status, body: res.body }
          }),
        )
        expect(real).toEqual(none)
        expect(real?.status).toBe(404)
      }
    })

    test('without signing in, is refused before the body is checked', async () => {
      for (const [path, method] of [
        [kind.own, 'GET'],
        [kind.own, 'POST'],
        [`${kind.own}/${athlete.userId}`, 'DELETE'],
        [theirs(), 'GET'],
        [theirs(), 'POST'],
      ] as const) {
        // oxlint-disable-next-line no-await-in-loop -- one route at a time.
        const res = await h.wire(path, { method, body: method === 'GET' ? undefined : '{}' })
        expect(res.status).toBe(401)
      }
    })
  })
})
