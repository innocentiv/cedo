import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { EntryTarget, Exercise, Workout, WorkoutSession } from '@cedo/contract'
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
async function planned(weightG: number) {
  const press = expectContract(
    Exercise,
    await post('/exercises', {
      name: 'Dumbbell Press',
      equipment: ['dumbbells'],
      muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
    }),
  )
  const workout = expectContract(Workout, await post('/workouts', { name: 'Push' }))
  const set = { targetReps: 8, targetWeightG: weightG }
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

/** A session of three sets of eight at `weightG`, finished. */
async function trained(p: Plan, weightG: number): Promise<void> {
  const id = await start(p)
  for (let i = 0; i < 3; i += 1) {
    await post(`/sessions/${id}/logs`, {
      exerciseId: p.exerciseId,
      entryId: p.entryId,
      weightG,
      reps: 8,
    })
  }
  await post(`/sessions/${id}`, { endedAt: new Date().toISOString() }, 'PATCH')
}

const targetOf = async (p: Plan) => {
  const id = await start(p)
  const [target] = expectContract(
    z.array(EntryTarget),
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

  test('with the weights not known, the plan stands — and 22 is still short of 22.5', async () => {
    const p = await planned(22_500)
    await trained(p, 22_000)
    const target = await targetOf(p)
    expect(target?.target.weightG).toBe(22_500)
    expect(target?.changed).toBe(false)
    expect(target?.limit).toBeNull()
  })
})
