import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, WorkoutSession, kgToG } from '@cedo/contract'
import { z } from 'zod'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/** What the picker leads with (#27): the exercises logged most lately, latest first. */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const anExercise = async (user: TestUser, name: string): Promise<string> =>
  expectContract(
    Exercise,
    (
      await user.wire('/exercises', {
        method: 'POST',
        body: JSON.stringify({ name, muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
      })
    ).body,
  ).id

/** One finished session, its sets of these exercises logged in this order. */
async function trained(user: TestUser, exerciseIds: readonly string[]): Promise<void> {
  const session = expectContract(
    WorkoutSession,
    (await user.wire('/sessions', { method: 'POST', body: JSON.stringify({}) })).body,
  )
  for (const exerciseId of exerciseIds) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the order is what is tested.
    await user.wire(`/sessions/${session.id}/logs`, {
      method: 'POST',
      body: JSON.stringify({ exerciseId, weightG: kgToG(60), reps: 5 }),
    })
  }
  await user.wire(`/sessions/${session.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ endedAt: new Date().toISOString() }),
  })
}

const recent = async (user: TestUser, query = ''): Promise<string[]> =>
  expectContract(z.array(Exercise), (await user.wire(`/exercises/recent${query}`)).body).map(
    (e) => e.name,
  )

describe('the exercises logged most lately', () => {
  test('come latest first, each once, however often it was logged', async () => {
    const squat = await anExercise(alice, 'Squat')
    const bench = await anExercise(alice, 'Bench')
    const row = await anExercise(alice, 'Row')
    await trained(alice, [squat, bench, squat])
    await trained(alice, [row])
    expect(await recent(alice)).toEqual(['Row', 'Squat', 'Bench'])
    expect(await recent(alice, '?limit=2')).toEqual(['Row', 'Squat'])
  })

  test("are the reader's own: someone else's training is not theirs to lead with", async () => {
    const squat = await anExercise(bob, 'Squat')
    await trained(bob, [squat])
    expect(await recent(alice)).toEqual([])
  })

  test('are none before anything is logged, and asked in a handful, not a page', async () => {
    expect(await recent(alice)).toEqual([])
    expect((await alice.wire('/exercises/recent?limit=21')).status).toBe(422)
  })
})
