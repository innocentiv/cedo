import { beforeEach, describe, expect, test } from 'bun:test'
import {
  Exercise,
  Today,
  Workout,
  WorkoutSession,
  WorkoutSessionSummary,
  kgToG,
  page,
} from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

/**
 * What to do next (#25): `GET /today`, and history that counts each session's personal bests. See
 * GLOSSARY.md, "Current workout", "Next day" and "Personal best".
 */

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

async function anExercise(user: TestUser, name: string): Promise<string> {
  const res = await user.wire('/exercises', {
    method: 'POST',
    body: JSON.stringify({ name, muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }] }),
  })
  return expectContract(Exercise, res.body).id
}

/** A workout of three days — A, B and C — each one entry of its own exercise. */
async function aThreeDayWorkout(user: TestUser): Promise<Workout> {
  const created = expectContract(
    Workout,
    (await user.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'ABC' }) })).body,
  )
  const day = async (name: string) => ({
    name,
    entries: [
      {
        exerciseId: await anExercise(user, `${name} lift`),
        sets: [{ targetReps: 5, targetWeightG: kgToG(60) }],
      },
    ],
  })
  const days = [await day('A'), await day('B'), await day('C')]
  const saved = await user.wire(`/workouts/${created.id}/plan`, {
    method: 'PUT',
    body: JSON.stringify({ days }),
  })
  return expectContract(Workout, saved.body)
}

const start = async (user: TestUser, body: Record<string, unknown> = {}) =>
  expectContract(
    WorkoutSession,
    (await user.wire('/sessions', { method: 'POST', body: JSON.stringify(body) })).body,
  )

const finish = async (user: TestUser, id: string): Promise<void> => {
  const res = await user.wire(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ endedAt: new Date().toISOString() }),
  })
  expect(res.status).toBe(200)
}

/** A session of `workout`'s day at `dayIndex`, finished. */
const trainDay = async (user: TestUser, workout: Workout, dayIndex: number): Promise<void> => {
  const session = await start(user, { workoutId: workout.id, dayId: workout.days[dayIndex]?.id })
  await finish(user, session.id)
}

const weekStart = (offsetMs = -60 * 60 * 1000) => new Date(Date.now() + offsetMs).toISOString()

const today = async (user: TestUser, from = weekStart()): Promise<Today> =>
  expectContract(Today, (await user.wire(`/today?weekStart=${encodeURIComponent(from)}`)).body)

describe('what to do next', () => {
  test('is nothing before anything is trained from a plan', async () => {
    expect(await today(alice)).toEqual({ inProgress: null, next: null, week: [] })
  })

  test('is the day after the one trained last, with its exercises, and the first after the last', async () => {
    const plan = await aThreeDayWorkout(alice)
    await trainDay(alice, plan, 0)
    expect((await today(alice)).next).toEqual({
      workoutId: plan.id,
      workoutName: 'ABC',
      dayId: plan.days[1]?.id ?? '',
      dayName: 'B',
      exercises: ['B lift'],
    })
    await trainDay(alice, plan, 2)
    expect((await today(alice)).next?.dayName).toBe('A')
  })

  test('counts a session in progress as the day trained last, and says it is in progress', async () => {
    const plan = await aThreeDayWorkout(alice)
    const open = await start(alice, { workoutId: plan.id, dayId: plan.days[1]?.id })
    const now = await today(alice)
    expect(now.inProgress?.id).toBe(open.id)
    expect(now.next?.dayName).toBe('C')
  })

  /** Logging without a plan is not following another one: the current workout stays. */
  test('is unmoved by a session without a plan', async () => {
    const plan = await aThreeDayWorkout(alice)
    await trainDay(alice, plan, 0)
    await finish(alice, (await start(alice)).id)
    expect((await today(alice)).next?.dayName).toBe('B')
  })

  test("is the reader's own: someone else's training moves nothing", async () => {
    const plan = await aThreeDayWorkout(alice)
    await trainDay(alice, plan, 0)
    await finish(bob, (await start(bob)).id)
    expect((await today(bob)).next).toBeNull()
    expect((await today(alice)).week).toHaveLength(1)
    expect((await today(bob)).inProgress).toBeNull()
  })
})

describe('the week', () => {
  test('is every session started since the week began, as the reader says it begins', async () => {
    const first = await start(alice)
    await finish(alice, first.id)
    await finish(alice, (await start(alice)).id)
    expect((await today(alice)).week).toHaveLength(2)
    expect((await today(alice, weekStart(60 * 60 * 1000))).week).toEqual([])
    expect((await today(alice)).week[0]).toBe(first.startedAt)
  })

  test('is asked from a start of week, never assumed', async () => {
    expect((await alice.wire('/today')).status).toBe(422)
  })
})

/** A history row says the personal bests its session set (#25), as the session itself does. */
describe('personal bests in history', () => {
  const Page = page(WorkoutSessionSummary)

  const sessionOf = async (exerciseId: string, kgs: readonly number[]): Promise<string> => {
    const session = await start(alice)
    for (const kg of kgs) {
      // oxlint-disable-next-line no-await-in-loop -- in order: each set is judged against the last.
      await alice.wire(`/sessions/${session.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({ exerciseId, weightG: kgToG(kg), reps: 5 }),
      })
    }
    await finish(alice, session.id)
    return session.id
  }

  const bests = async (query: string) => {
    const listed = expectContract(Page, (await alice.wire(`/sessions?${query}`)).body)
    return { counts: listed.items.map((s) => s.personalBests), next: listed.nextCursor }
  }

  test('are counted per session, each against every session before it — on any page', async () => {
    const bench = await anExercise(alice, 'Bench')
    await sessionOf(bench, [100])
    await sessionOf(bench, [105, 110])
    await sessionOf(bench, [100])

    expect((await bests('limit=20')).counts).toEqual([0, 2, 0])
    // Paged one at a time, the middle session is still judged against the first.
    const first = await bests('limit=1')
    expect(first.counts).toEqual([0])
    const second = await bests(`limit=1&cursor=${first.next ?? ''}`)
    expect(second.counts).toEqual([2])
  })
})
