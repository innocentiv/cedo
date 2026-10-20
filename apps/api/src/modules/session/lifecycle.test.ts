import { beforeEach, describe, expect, test } from 'bun:test'
import {
  ApiError,
  Exercise,
  SessionStart,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/client.ts'
import { workoutSessions } from '../../db/schema.ts'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { start as startSession } from './start.ts'

/**
 * A session is in progress until it is finished, and finishing is final: no more sets, none undone,
 * no reopening — and one in progress at a time. The screens promised all of it; the API kept only
 * the first. See GLOSSARY.md, "Session".
 */

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const send = async (path: string, method: string, body?: unknown) =>
  await alice.wire(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

const start = async () => await send('/sessions', 'POST', {})
const started = async () => expectContract(WorkoutSession, (await start()).body)
const finish = async (id: string, endedAt = new Date().toISOString()) =>
  await send(`/sessions/${id}`, 'PATCH', { endedAt })
const read = async (id: string) =>
  expectContract(WorkoutSession, (await alice.wire(`/sessions/${id}`)).body)
const refusal = (body: unknown) => expectContract(ApiError, body).error.message

async function aLoggedSet(sessionId: string): Promise<string> {
  const exercise = expectContract(
    Exercise,
    (
      await send('/exercises', 'POST', {
        name: 'Bench Press',
        muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
      })
    ).body,
  )
  const res = await send(`/sessions/${sessionId}/logs`, 'POST', {
    exerciseId: exercise.id,
    reps: 8,
  })
  return expectContract(WorkoutSession.shape.logs.element, res.body).id
}

describe('finishing is final', () => {
  test('a finished session is never reopened: the contract refuses a null end', async () => {
    const { id } = await started()
    await finish(id)
    const reopened = await send(`/sessions/${id}`, 'PATCH', { endedAt: null })
    expect(reopened.status).toBe(422)
    expect((await read(id)).endedAt).not.toBeNull()
  })

  test('nor finished again: its end stays where it was', async () => {
    const { id } = await started()
    await finish(id)
    const ended = (await read(id)).endedAt
    const again = await finish(id, new Date(Date.now() + 3_600_000).toISOString())
    expect(again.status).toBe(409)
    expect(refusal(again.body)).toBe('That session has already been finished')
    expect((await read(id)).endedAt).toBe(ended)
  })

  test('and none of its sets is undone', async () => {
    const { id } = await started()
    const logId = await aLoggedSet(id)
    await finish(id)
    const undone = await send(`/sessions/${id}/logs/${logId}`, 'DELETE')
    expect(undone.status).toBe(409)
    expect((await read(id)).logs.map((l) => l.id)).toEqual([logId])
  })

  test('its notes stay editable — a journal, not a change to what was logged', async () => {
    const { id } = await started()
    await finish(id)
    const noted = await send(`/sessions/${id}`, 'PATCH', { notes: 'Felt strong.' })
    expect(noted.status).toBe(200)
    expect((await read(id)).notes).toBe('Felt strong.')
  })
})

describe('one session in progress at a time', () => {
  test('a second is refused while one is in progress; once it is finished, the next starts', async () => {
    const { id } = await started()
    const second = await start()
    expect(second.status).toBe(409)
    expect(refusal(second.body)).toBe('A session is already in progress')

    await finish(id)
    expect((await start()).status).toBe(200)
  })

  /**
   * Checked first for the message; the index is what holds when starts arrive together. Thirty, on
   * the service: six through the harness never overlapped, and without the index thirty made 26
   * sessions. Watched failing with the index dropped.
   */
  test('of starts that race, exactly one wins', async () => {
    const results = await Promise.allSettled(
      Array.from(
        { length: 30 },
        async () => await startSession(alice.caller, SessionStart.parse({})),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refusals = results.flatMap((r) =>
      r.status === 'fulfilled'
        ? []
        : [r.reason instanceof Error ? r.reason.message : 'not an Error'],
    )
    expect(new Set(refusals)).toEqual(new Set(['A session is already in progress']))
    const open = await db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.userId, alice.userId), isNull(workoutSessions.endedAt)))
    expect(open).toHaveLength(1)
  })

  test('is found by asking for it, however many finished sessions are newer', async () => {
    const { id } = await started()
    // Twenty-five finished sessions since — a whole page and more.
    await db.insert(workoutSessions).values(
      Array.from({ length: 25 }, (_, i) => ({
        userId: alice.userId,
        startedAt: new Date(Date.now() + (i + 1) * 60_000),
        endedAt: new Date(Date.now() + (i + 1) * 60_000 + 30_000),
      })),
    )
    const list = async (query: string) =>
      expectContract(page(WorkoutSessionSummary), (await alice.wire(`/sessions?${query}`)).body)

    expect((await list('inProgress=true&limit=1')).items.map((s) => s.id)).toEqual([id])
    const finished = await list('inProgress=false&limit=100')
    expect(finished.items).toHaveLength(25)
    expect(finished.items.some((s) => s.id === id)).toBe(false)
  })
})
