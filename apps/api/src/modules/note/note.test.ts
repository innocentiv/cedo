import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ApiError, AthleteNote, GroupMembership, NOTES_PER_ATHLETE } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteNotes, users } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { create } from './service.ts'

/**
 * Athlete notes (#41): written by the athlete or a coach of theirs, read by both. Only the author
 * changes a note's words; the author or the athlete removes it. See GLOSSARY.md, "Athlete note".
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

const notes = async (user: TestUser, path = '/notes') =>
  expectContract(z.array(AthleteNote), (await user.wire(path)).body)

const write = async (user: TestUser, path: string, text: string) =>
  expectContract(AthleteNote, await ok(user, path, { text }))

beforeEach(async () => {
  h = await makeApi()
  coach = await h.as('coach')
  athlete = await h.as('athlete')
  squadId = expectContract(GroupMembership, await ok(coach, '/groups', { name: 'Squad' })).id
  await ok(coach, `/groups/${squadId}/members`, { username: athlete.username, role: 'reader' })
  await share(athlete, squadId, true)
})

const theirs = () => `/athletes/${athlete.userId}/notes`

describe('your own notes', () => {
  test('are none at first, then each written, newest first, by you', async () => {
    expect(await notes(athlete)).toEqual([])
    const first = await write(athlete, '/notes', 'I hate lunges')
    const second = await write(athlete, '/notes', '  Away 10–17 Nov  ')
    expect(second).toMatchObject({
      text: 'Away 10–17 Nov',
      author: { id: athlete.userId },
      editedAt: null,
      canEdit: true,
      canDelete: true,
    })
    expect((await notes(athlete)).map((n) => n.id)).toEqual([second.id, first.id])
  })

  test('are changed in their words, and say when; and removed', async () => {
    const note = await write(athlete, '/notes', 'Left knee sore')
    const changed = expectContract(
      AthleteNote,
      await ok(athlete, `/notes/${note.id}`, { text: 'Left knee fine again' }, 'PATCH'),
    )
    expect(changed).toMatchObject({ id: note.id, text: 'Left knee fine again' })
    expect(changed.writtenAt).toBe(note.writtenAt)
    expect(changed.editedAt).not.toBeNull()
    expect(await ok(athlete, `/notes/${note.id}`, undefined, 'DELETE')).toEqual({ ok: true })
    expect(await notes(athlete)).toEqual([])
  })

  test('are yours: another person reads none, and changes none', async () => {
    const stranger = await h.as('stranger')
    const note = await write(athlete, '/notes', 'Prefers mornings')
    expect(await notes(stranger)).toEqual([])
    expect((await send(stranger, `/notes/${note.id}`, { text: 'x' }, 'PATCH')).status).toBe(404)
    expect((await send(stranger, `/notes/${note.id}`, undefined, 'DELETE')).status).toBe(404)
    expect((await notes(athlete)).map((n) => n.text)).toEqual(['Prefers mornings'])
  })

  test('refuse empty words, too many, and anything but words', async () => {
    for (const body of [{ text: '   ' }, { text: 'x'.repeat(4001) }, { text: 'x', pinned: true }]) {
      const refused = await send(athlete, '/notes', body)
      expect(refused.status).toBe(422)
      expectContract(ApiError, refused.body)
    }
    expect(await notes(athlete)).toEqual([])
  })
})

describe('a coach', () => {
  test('writes notes about an athlete, which the athlete reads under the coach’s name', async () => {
    const note = await write(coach, theirs(), 'Shoulder hurts on overhead work')
    expect(note).toMatchObject({ canEdit: true, canDelete: true })
    const [read] = await notes(athlete)
    expect(read).toMatchObject({
      id: note.id,
      author: { id: coach.userId, displayName: coach.caller.displayName },
      canEdit: false,
      canDelete: true,
    })
  })

  test('reads the athlete’s own notes, and changes none of them', async () => {
    const own = await write(athlete, '/notes', 'Wants to squat 100 kg by summer')
    const [read] = await notes(coach, theirs())
    expect(read).toMatchObject({ id: own.id, canEdit: false, canDelete: false })
    expect((await send(coach, `${theirs()}/${own.id}`, { text: 'x' }, 'PATCH')).status).toBe(404)
    expect((await send(coach, `${theirs()}/${own.id}`, undefined, 'DELETE')).status).toBe(404)
    expect((await notes(athlete))[0]?.text).toBe('Wants to squat 100 kg by summer')
  })

  test('changes and removes their own note about an athlete', async () => {
    const note = await write(coach, theirs(), 'Deload next week')
    await ok(coach, `${theirs()}/${note.id}`, { text: 'Deload the week after' }, 'PATCH')
    expect((await notes(athlete))[0]?.text).toBe('Deload the week after')
    await ok(coach, `${theirs()}/${note.id}`, undefined, 'DELETE')
    expect(await notes(athlete)).toEqual([])
  })

  test('another coach of theirs reads the note, and changes none of it', async () => {
    const other = await h.as('other')
    await ok(coach, `/groups/${squadId}/members`, { username: other.username, role: 'editor' })
    const note = await write(coach, theirs(), 'Travelling in November')
    const [read] = await notes(other, theirs())
    expect(read).toMatchObject({ id: note.id, canEdit: false, canDelete: false })
    expect((await send(other, `${theirs()}/${note.id}`, { text: 'x' }, 'PATCH')).status).toBe(404)
    expect((await send(other, `${theirs()}/${note.id}`, undefined, 'DELETE')).status).toBe(404)
  })

  test('reaches a note only through the athlete it is about', async () => {
    const other = await h.as('other')
    await ok(coach, `/groups/${squadId}/members`, { username: other.username, role: 'reader' })
    await share(other, squadId, true)
    const note = await write(coach, theirs(), 'About the athlete')
    const wrong = `/athletes/${other.userId}/notes/${note.id}`
    expect((await send(coach, wrong, { text: 'x' }, 'PATCH')).status).toBe(404)
    expect((await send(coach, wrong, undefined, 'DELETE')).status).toBe(404)
    expect((await notes(athlete))[0]?.text).toBe('About the athlete')
  })
})

describe('the athlete', () => {
  test('removes a coach’s note about them, but changes none of its words', async () => {
    const note = await write(coach, theirs(), 'Too much volume last block')
    const refused = await send(athlete, `/notes/${note.id}`, { text: 'x' }, 'PATCH')
    expect(refused.status).toBe(404)
    expect((await notes(athlete))[0]?.text).toBe('Too much volume last block')
    await ok(athlete, `/notes/${note.id}`, undefined, 'DELETE')
    expect(await notes(coach, theirs())).toEqual([])
  })

  test('keeps a coach’s notes when they stop sharing, and the coach reaches none', async () => {
    const note = await write(coach, theirs(), 'Bad ankle')
    await share(athlete, squadId, false)
    expect((await notes(athlete))[0]).toMatchObject({ id: note.id, author: { id: coach.userId } })
    for (const [path, body, method] of [
      [theirs(), undefined, 'GET'],
      [theirs(), { text: 'x' }, 'POST'],
      [`${theirs()}/${note.id}`, { text: 'x' }, 'PATCH'],
      [`${theirs()}/${note.id}`, undefined, 'DELETE'],
    ] as const) {
      expect((await send(coach, path, body, method)).status).toBe(404)
    }
  })

  test('reads a note whose author’s account is gone as a former coach’s', async () => {
    const note = await write(coach, theirs(), 'Watch the left knee')
    await db.delete(users).where(eq(users.id, coach.userId))
    expect((await notes(athlete))[0]).toMatchObject({ id: note.id, author: null, canEdit: false })
  })
})

describe('someone who is not shared with', () => {
  test('is told the same of an athlete as of nobody, on every route', async () => {
    const stranger = await h.as('stranger')
    const nobody = '00000000-0000-4000-8000-000000000000'
    const replies = await Promise.all(
      [athlete.userId, nobody].map(async (id) => {
        const res = await send(stranger, `/athletes/${id}/notes`, { text: 'x' })
        return { status: res.status, body: res.body }
      }),
    )
    expect(replies[0]).toEqual(replies[1])
    expect(replies[0]?.status).toBe(404)
  })

  test('without signing in, is refused before the body is checked', async () => {
    for (const [path, method] of [
      ['/notes', 'GET'],
      ['/notes', 'POST'],
      [`/notes/${athlete.userId}`, 'PATCH'],
      [`/notes/${athlete.userId}`, 'DELETE'],
      [theirs(), 'GET'],
      [theirs(), 'POST'],
    ] as const) {
      const res = await h.wire(path, { method, body: method === 'GET' ? undefined : '{}' })
      expect(res.status).toBe(401)
    }
  })
})

describe('how many', () => {
  const fill = async (n: number) => {
    await db.insert(athleteNotes).values(
      Array.from({ length: n }, (_, i) => ({
        athleteId: athlete.userId,
        authorId: athlete.userId,
        text: `Note ${String(i)}`,
      })),
    )
  }

  test(`at most ${String(NOTES_PER_ATHLETE)}: one more asks for one no longer true to go`, async () => {
    await fill(NOTES_PER_ATHLETE)
    const refused = await send(coach, theirs(), { text: 'One more' })
    expect(refused.status).toBe(409)
    expect(expectContract(ApiError, refused.body).error.message).toBe(
      'Remove a note that is no longer true first',
    )
  })

  /** Written at once, they take turns at the count: without the lock, each passes it. */
  test('written at once, never past the most', async () => {
    await fill(NOTES_PER_ATHLETE - 1)
    // A cold pool opens its connections one by one, which lines the writes up: warm it first.
    await Promise.all(Array.from({ length: 30 }, async () => await db.execute(sql`select 1`)))
    const tries = await Promise.allSettled(
      Array.from(
        { length: 30 },
        async () => await create(athlete.caller, undefined, { text: 'x' }),
      ),
    )
    expect(tries.filter((t) => t.status === 'fulfilled')).toHaveLength(1)
    expect(await notes(athlete)).toHaveLength(NOTES_PER_ATHLETE)
  })
})
