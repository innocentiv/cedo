import { beforeEach, describe, expect, test } from 'bun:test'
import {
  Exercise,
  GroupMembership,
  SessionDetail,
  Workout,
  WorkoutSession,
  page,
} from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'

let h: TestApi
let alice: TestUser

const NEEDS = {
  'Goblet Squat Home': ['dumbbells'],
  'Back Squat Gym': ['barbell', 'rack'],
  'Dumbbell Bench Home': ['dumbbells', 'flat_bench'],
  'Push-Up Anywhere': [],
  'Mystery Lift': null,
} as const

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  for (const [name, equipment] of Object.entries(NEEDS)) {
    await alice.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify({
        name,
        equipment,
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      }),
    })
  }
})

const have = async (items: string[]) =>
  await alice.wire('/equipment', {
    method: 'PUT',
    body: JSON.stringify({ items: items.map((slug) => ({ slug, weights: null })) }),
  })

const listed = async (query = '') => {
  const body = (await alice.wire(`/exercises?scope=mine&limit=50${query}`)).body
  return expectContract(page(Exercise), body).items
}

const names = (items: readonly Exercise[]) => items.map((e) => e.name).toSorted()

/**
 * Doable (#35): what the caller can do with what they have. The list's condition is SQL and each
 * exercise's flag is the contract's `isDoable`: both are asked here, so they cannot disagree.
 */
describe('doable', () => {
  test('before you say what you have, every exercise is offered, and each is doable', async () => {
    const all = await listed()
    expect(names(all)).toEqual(Object.keys(NEEDS).toSorted())
    expect(all.every((e) => e.doable)).toBe(true)
  })

  test('once you have, only what you can do — needing nothing, or undescribed, included', async () => {
    await have(['dumbbells', 'flat_bench'])
    const mine = await listed()
    expect(names(mine)).toEqual([
      'Dumbbell Bench Home',
      'Goblet Squat Home',
      'Mystery Lift',
      'Push-Up Anywhere',
    ])
    expect(mine.every((e) => e.doable)).toBe(true)
  })

  test('show all lists the rest too, each marked as the list would have judged it', async () => {
    await have(['dumbbells'])
    const all = await listed('&showAll=true')
    expect(names(all)).toEqual(Object.keys(NEEDS).toSorted())
    const doable = names(all.filter((e) => e.doable))
    expect(doable).toEqual(names(await listed()))
    expect(doable).toEqual(['Goblet Squat Home', 'Mystery Lift', 'Push-Up Anywhere'])
    // "false" in a query string is false, not a non-empty string.
    expect(names(await listed('&showAll=false'))).toEqual(doable)
  })

  test('having nothing at all leaves what needs nothing, and what nobody described', async () => {
    await have([])
    expect(names(await listed())).toEqual(['Mystery Lift', 'Push-Up Anywhere'])
  })

  test('a plan keeps an exercise you cannot do, and marks it', async () => {
    const all = await listed()
    const gym = all.find((e) => e.name === 'Back Squat Gym')
    if (gym === undefined) throw new Error('no gym squat')
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Block' }) }))
        .body,
    )
    const saved = await alice.wire(`/workouts/${workout.id}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        days: [
          {
            name: 'A',
            entries: [{ exerciseId: gym.id, sets: [{ targetReps: 5, targetWeightG: 60_000 }] }],
          },
        ],
      }),
    })
    expect(saved.status).toBe(200)
    await have(['dumbbells'])
    const read = expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body)
    const entry = read.days[0]?.entries[0]
    expect(entry?.exercise?.name).toBe('Back Squat Gym')
    expect(entry?.exercise?.doable).toBe(false)
  })

  /** A coach reads an athlete's session: what is doable is the athlete's to say, not the coach's. */
  test("an athlete's session, read by their coach, is judged by the athlete's equipment", async () => {
    const coach = await h.as('coach')
    const post = async (user: TestUser, path: string, body: unknown, method = 'POST') =>
      (await user.wire(path, { method, body: JSON.stringify(body) })).body
    const squad = expectContract(GroupMembership, await post(coach, '/groups', { name: 'Squad' }))
    await post(coach, `/groups/${squad.id}/members`, { username: alice.username, role: 'reader' })
    await post(alice, `/groups/${squad.id}/membership`, { sharesTraining: true }, 'PATCH')
    const lift = expectContract(
      Exercise,
      await post(coach, '/exercises', {
        name: 'Squad Dumbbell Press',
        equipment: ['dumbbells'],
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      }),
    )
    await post(coach, `/exercises/${lift.id}/transfer`, { toGroupId: squad.id })
    // The squad's plan, which both can read: the coach writes it, the athlete trains from it.
    const workout = expectContract(Workout, await post(coach, '/workouts', { name: 'Press' }))
    const planned = expectContract(
      Workout,
      await post(
        coach,
        `/workouts/${workout.id}/plan`,
        { days: [{ name: 'A', entries: [{ exerciseId: lift.id, sets: [{ targetReps: 5 }] }] }] },
        'PUT',
      ),
    )
    const dayId = planned.days[0]?.id
    await post(coach, `/workouts/${workout.id}/transfer`, { toGroupId: squad.id })
    const session = expectContract(
      WorkoutSession,
      await post(alice, '/sessions', { workoutId: workout.id, dayId }),
    )
    await have(['dumbbells'])
    await post(coach, '/equipment', { items: [{ slug: 'rack', weights: null }] }, 'PUT')

    const read = expectContract(
      SessionDetail,
      (await coach.wire(`/athletes/${alice.userId}/sessions/${session.id}`)).body,
    )
    if (read.plan === null || !read.plan.reachable) throw new Error('no plan read')
    expect(read.plan.day.entries[0]?.exercise?.doable).toBe(true)
  })
})
