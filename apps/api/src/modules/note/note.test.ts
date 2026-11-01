import { beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ApiError, AthleteNote, NOTES_PER_ATHLETE } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { athleteNotes, users } from '../../db/schema.ts'
import { anotherAthlete, coachedSquad, ok, send, share } from '../../test/coaching.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { create } from './service.ts'

/**
 * Athlete notes (#41): what is a note's own — its words, which only its author changes, and at most
 * `NOTES_PER_ATHLETE` about anyone. Read, written and removed as every athlete record is:
 * ../athlete-record/athlete-record.test.ts. See GLOSSARY.md, "Athlete note".
 */

let h: TestApi
let coach: TestUser
let athlete: TestUser
let squadId: string

const notes = async (user: TestUser, path = '/notes') =>
  expectContract(z.array(AthleteNote), (await user.wire(path)).body)

const write = async (user: TestUser, path: string, text: string) =>
  expectContract(AthleteNote, await ok(user, path, { text }))

const reword = async (user: TestUser, path: string) =>
  await send(user, path, { text: 'x' }, 'PATCH')

beforeEach(async () => {
  h = await makeApi()
  ;({ coach, athlete, squadId } = await coachedSquad(h))
})

const theirs = () => `/athletes/${athlete.userId}/notes`

describe('a note’s words', () => {
  test('are trimmed, and changed by their author, who is told when', async () => {
    const note = await write(athlete, '/notes', '  Left knee sore  ')
    expect(note).toMatchObject({ text: 'Left knee sore', editedAt: null, canEdit: true })
    const changed = expectContract(
      AthleteNote,
      await ok(athlete, `/notes/${note.id}`, { text: 'Left knee fine again' }, 'PATCH'),
    )
    expect(changed).toMatchObject({ id: note.id, text: 'Left knee fine again' })
    expect(changed.writtenAt).toBe(note.writtenAt)
    expect(changed.editedAt).not.toBeNull()
  })

  test('are refused empty, too many, and with anything but words', async () => {
    for (const body of [{ text: '   ' }, { text: 'x'.repeat(4001) }, { text: 'x', pinned: true }]) {
      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time.
      const refused = await send(athlete, '/notes', body)
      expect(refused.status).toBe(422)
      expectContract(ApiError, refused.body)
    }
    expect(await notes(athlete)).toEqual([])
  })

  test('are changed by no one but their author', async () => {
    const stranger = await h.as('stranger')
    const other = await h.as('other')
    await ok(coach, `/groups/${squadId}/members`, { username: other.username, role: 'editor' })
    const own = await write(athlete, '/notes', 'Wants to squat 100 kg by summer')
    const coachs = await write(coach, theirs(), 'Too much volume last block')
    expect(coachs.canEdit).toBe(true)

    expect((await reword(stranger, `/notes/${own.id}`)).status).toBe(404)
    expect((await reword(coach, `${theirs()}/${own.id}`)).status).toBe(404)
    expect((await reword(other, `${theirs()}/${coachs.id}`)).status).toBe(404)
    expect((await reword(athlete, `/notes/${coachs.id}`)).status).toBe(404)

    const read = await notes(athlete)
    expect(read.map((n) => [n.text, n.canEdit])).toEqual([
      ['Too much volume last block', false],
      ['Wants to squat 100 kg by summer', true],
    ])
    expect((await notes(coach, theirs())).map((n) => n.canEdit)).toEqual([true, false])
    expect((await notes(other, theirs())).map((n) => n.canEdit)).toEqual([false, false])
  })

  test('are changed only through the athlete the note is about', async () => {
    const other = await anotherAthlete(h, coach, squadId)
    const note = await write(coach, theirs(), 'About the athlete')
    const wrong = `/athletes/${other.userId}/notes/${note.id}`
    expect((await reword(coach, wrong)).status).toBe(404)
    expect((await notes(athlete))[0]?.text).toBe('About the athlete')
  })

  test('of a coach’s note, are the coach’s to change while the athlete shares', async () => {
    const note = await write(coach, theirs(), 'Deload next week')
    await ok(coach, `${theirs()}/${note.id}`, { text: 'Deload the week after' }, 'PATCH')
    expect((await notes(athlete))[0]?.text).toBe('Deload the week after')
    await share(athlete, squadId, false)
    expect((await reword(coach, `${theirs()}/${note.id}`)).status).toBe(404)
  })

  test('are no one’s to change once their author’s account is gone', async () => {
    await write(coach, theirs(), 'Watch the left knee')
    await db.delete(users).where(eq(users.id, coach.userId))
    expect((await notes(athlete))[0]).toMatchObject({ author: null, canEdit: false })
  })

  test('without signing in, are refused before the body is checked', async () => {
    const res = await h.wire(`/notes/${athlete.userId}`, { method: 'PATCH', body: '{}' })
    expect(res.status).toBe(401)
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
