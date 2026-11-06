import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Exercise, SessionEntryTarget, Workout, WorkoutSession } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const post = async (path: string, body: unknown, method = 'POST') => {
  const res = await alice.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status}`)
  return res.body
}

/** A dumbbell press planned at `weightG` for three sets of eight, linear by 2.5 kg. */
async function planned(weightG: number, targetReserve: number | null = null) {
  const press = expectContract(
    Exercise,
    await post('/exercises', {
      name: 'Dumbbell Press',
      equipment: ['dumbbells'],
      muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
    }),
  )
  const workout = expectContract(Workout, await post('/workouts', { name: 'Push' }))
  const set = { targetReps: 8, targetWeightG: weightG, targetReserve }
  const plan = expectContract(
    Workout,
    await post(
      `/workouts/${workout.id}/plan`,
      {
        days: [
          {
            name: 'A',
            entries: [
              {
                exerciseId: press.id,
                sets: [set, set, set],
                progression: { kind: 'linear', incrementG: 2500, afterSuccesses: 1 },
              },
            ],
          },
        ],
      },
      'PUT',
    ),
  )
  const day = plan.days[0]
  const entry = day?.entries[0]
  if (day === undefined || entry === undefined) throw new Error('no plan')
  return { workoutId: workout.id, dayId: day.id, entryId: entry.id, exerciseId: press.id }
}

type Plan = Awaited<ReturnType<typeof planned>>

const start = async (p: Plan) =>
  expectContract(
    WorkoutSession,
    await post('/sessions', { workoutId: p.workoutId, dayId: p.dayId }),
  ).id

/** A session of three sets of eight at `weightG`, each leaving `reserve`, finished. */
async function trained(p: Plan, weightG: number, reserve: number | null = null): Promise<void> {
  const id = await start(p)
  for (let i = 0; i < 3; i += 1) {
    await post(`/sessions/${id}/logs`, {
      exerciseId: p.exerciseId,
      entryId: p.entryId,
      weightG,
      reps: 8,
      reserve,
    })
  }
  await post(`/sessions/${id}`, { endedAt: new Date().toISOString() }, 'PATCH')
}

const targetOf = async (p: Plan) => {
  const id = await start(p)
  const [target] = expectContract(
    z.array(SessionEntryTarget),
    (await alice.wire(`/sessions/${id}/targets`)).body,
  )
  return target
}

const dumbbells = (maxG: number | null = 30_000) =>
  post(
    '/equipment',
    { items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG } }] },
    'PUT',
  )

/**
 * The logger's targets in weights the athlete can load (#36) — and the bug #32 began with: a 22.5 kg
 * plan on dumbbells that go 2 kg at a time was missed at 22 every session, and never moved.
 */
describe("targets in the athlete's weights", () => {
  test('a 22.5 kg plan logged at 22 on 2 kg dumbbells is met, and asks 24 next', async () => {
    await dumbbells()
    const p = await planned(22_500)
    await trained(p, 22_000)
    const target = await targetOf(p)
    expect(target?.prescribed.weightG).toBe(22_500)
    expect(target?.target.weightG).toBe(24_000)
    expect(target?.changed).toBe(true)
    expect(target?.limit).toBeNull()
  })

  test('before anything is logged, the plan is shown as it can be loaded — not as progressed', async () => {
    await dumbbells()
    const target = await targetOf(await planned(22_500))
    expect(target?.target.weightG).toBe(22_000)
    expect(target?.changed).toBe(false)
  })

  test('at the heaviest dumbbell it stops there, and says so', async () => {
    await dumbbells(24_000)
    const target = await targetOf(await planned(25_000))
    expect(target?.target.weightG).toBe(24_000)
    expect(target?.limit).toBe('heaviest')
  })

  /** #66: trained up to the heaviest dumbbell, it stayed there and never said why. */
  test('trained up to the heaviest dumbbell, it stays there, and says so', async () => {
    await dumbbells()
    const p = await planned(28_000)
    await trained(p, 28_000)
    await trained(p, 30_000)
    // 28 cleared asks 30; 30 cleared asks 32.5, which no dumbbell weighs: it stays at 30.
    expect(await targetOf(p)).toMatchObject({
      target: { weightG: 30_000 },
      changed: true,
      limit: 'heaviest',
    })
  })

  test('with the weights not known, the plan stands — and 22 is still short of 22.5', async () => {
    const p = await planned(22_500)
    await trained(p, 22_000)
    const target = await targetOf(p)
    expect(target?.target.weightG).toBe(22_500)
    expect(target?.changed).toBe(false)
    expect(target?.limit).toBeNull()
  })
})

/** A prescribed reserve is a floor (#45): the logger is told when a set ground out past it held. */
describe('a prescribed reserve, as the logger is told it', () => {
  test('a session ground out past it holds, and says why', async () => {
    const p = await planned(60_000, 2)
    await trained(p, 60_000, 0)
    const target = await targetOf(p)
    expect(target?.target.weightG).toBe(60_000)
    expect(target?.changed).toBe(false)
    expect(target?.held).toEqual({ reason: 'effort', set: 1, reserve: 0, asked: 2 })
  })

  test('a session within it advances, and nothing held it', async () => {
    const p = await planned(60_000, 2)
    await trained(p, 60_000, 2)
    const target = await targetOf(p)
    expect(target?.target.weightG).toBe(62_500)
    expect(target?.held).toBeNull()
  })
})
