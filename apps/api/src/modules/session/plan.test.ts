import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, GroupMembership, SessionDetail, Workout, WorkoutSession } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * A session read on its own carries the plan it follows, as the reader can reach it — the server's
 * answer, from the same visible relations it numbers sets by. The session screen used to join
 * three reads itself, and took a plan it failed to FETCH for one out of reach. See `SessionPlan`.
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

const post = async (user: TestUser, path: string, body: unknown) =>
  await user.wire(path, { method: 'POST', body: JSON.stringify(body) })

async function anExercise(user: TestUser, name: string): Promise<string> {
  const body = { name, muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }] }
  return expectContract(Exercise, (await post(user, '/exercises', body)).body).id
}

/** A one-day plan, "Push", with one entry per exercise given — each two working sets and a warm-up. */
async function aPlan(user: TestUser, exerciseIds: readonly string[]): Promise<Workout> {
  const { id } = expectContract(Workout, (await post(user, '/workouts', { name: 'Plan' })).body)
  const entries = exerciseIds.map((exerciseId) => ({
    exerciseId,
    sets: [{ targetReps: 10, isWarmup: true }, { targetReps: 8 }, { targetReps: 8 }],
  }))
  const saved = await user.wire(`/workouts/${id}/plan`, {
    method: 'PUT',
    body: JSON.stringify({ days: [{ name: 'Push', entries }] }),
  })
  return expectContract(Workout, saved.body)
}

async function startFrom(user: TestUser, workout: Workout): Promise<string> {
  const dayId = workout.days[0]?.id
  return expectContract(
    WorkoutSession,
    (await post(user, '/sessions', { workoutId: workout.id, dayId })).body,
  ).id
}

const read = async (user: TestUser, sessionId: string) =>
  expectContract(SessionDetail, (await user.wire(`/sessions/${sessionId}`)).body)

/** A group of alice's with bob in it, as a reader. */
async function aSquad(): Promise<string> {
  const squad = expectContract(
    GroupMembership,
    (await post(alice, '/groups', { name: 'Squad' })).body,
  )
  await post(alice, `/groups/${squad.id}/members`, { username: 'bob', role: 'reader' })
  return squad.id
}

describe('the plan a session follows', () => {
  test('is the day, each entry with its exercise and the working sets done in its series', async () => {
    const bench = await anExercise(alice, 'Bench Press')
    const workout = await aPlan(alice, [bench, bench])
    const [first, second] = workout.days[0]?.entries ?? []
    if (first === undefined || second === undefined) throw new Error('the plan has two entries')
    const id = await startFrom(alice, workout)

    const log = async (body: Record<string, unknown>) =>
      await post(alice, `/sessions/${id}/logs`, { exerciseId: bench, reps: 8, ...body })
    await log({ entryId: first.id, isWarmup: true })
    await log({ entryId: first.id })
    await log({ entryId: first.id })
    await log({ entryId: second.id })
    // The same exercise with no entry: its own series, done for neither entry.
    await log({})

    const { plan } = await read(alice, id)
    if (plan === null || !plan.reachable)
      throw new Error(`expected a reachable day: ${JSON.stringify(plan)}`)
    expect(plan.day.name).toBe('Push')
    expect(plan.day.entries.map((e) => [e.id, e.exercise?.name, e.done])).toEqual([
      [first.id, 'Bench Press', 2],
      [second.id, 'Bench Press', 1],
    ])

    // Finished, it still names its day.
    await alice.wire(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })
    expect((await read(alice, id)).plan).toMatchObject({ reachable: true, day: { name: 'Push' } })
  })

  test("carries the workout's notes, to be read while it is trained (#51)", async () => {
    const workout = await aPlan(alice, [await anExercise(alice, 'Bench Press')])
    const id = await startFrom(alice, workout)
    expect((await read(alice, id)).plan).toMatchObject({ reachable: true, workoutNotes: null })

    await alice.wire(`/workouts/${workout.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'On a bad day, drop 10% and finish.' }),
    })
    expect((await read(alice, id)).plan).toMatchObject({
      reachable: true,
      workoutNotes: 'On a bad day, drop 10% and finish.',
    })
  })

  test('is none for a session started without one', async () => {
    const { id } = expectContract(WorkoutSession, (await post(alice, '/sessions', {})).body)
    expect((await read(alice, id)).plan).toBeNull()
  })

  test('is none once its day is removed from the plan', async () => {
    const workout = await aPlan(alice, [await anExercise(alice, 'Bench Press')])
    const id = await startFrom(alice, workout)
    // Saved with a day that carries no id: the old one is removed, and the session loses it.
    await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({ days: [{ name: 'Pull', entries: [] }] }),
    })

    const session = await read(alice, id)
    expect(session.dayId).toBeNull()
    expect(session.plan).toBeNull()
  })

  test('is out of reach once the reader leaves the group it lives in', async () => {
    const squad = await aSquad()
    const bench = await anExercise(alice, 'Bench Press')
    // Into the group first: a shared plan may only use what every member can read.
    await post(alice, `/exercises/${bench}/transfer`, { toGroupId: squad })
    const workout = await aPlan(alice, [bench])
    const moved = await post(alice, `/workouts/${workout.id}/transfer`, { toGroupId: squad })
    expect(moved.status).toBe(200)
    const id = await startFrom(bob, workout)
    const entry = workout.days[0]?.entries[0]
    await post(bob, `/sessions/${id}/logs`, {
      exerciseId: entry?.exerciseId,
      entryId: entry?.id,
      reps: 8,
    })

    await alice.wire(`/groups/${squad}/members/${bob.userId}`, { method: 'DELETE' })

    const session = await read(bob, id)
    expect(session.plan).toEqual({ reachable: false })
    // The same answer the numbering gives: the set counts as logged without a plan.
    expect(session.logs.map((l) => l.entryId)).toEqual([null])
  })

  test('names an exercise the reader can no longer see as unavailable, and keeps its entry', async () => {
    const squad = await aSquad()
    const coached = await anExercise(alice, 'Coached Press')
    await post(alice, `/exercises/${coached}/transfer`, { toGroupId: squad })
    const workout = await aPlan(bob, [coached])
    const id = await startFrom(bob, workout)

    await alice.wire(`/groups/${squad}/members/${bob.userId}`, { method: 'DELETE' })

    const { plan } = await read(bob, id)
    if (plan === null || !plan.reachable)
      throw new Error(`expected a reachable day: ${JSON.stringify(plan)}`)
    expect(plan.day.entries.map((e) => [e.exercise, e.done])).toEqual([[null, 0]])
  })
})
