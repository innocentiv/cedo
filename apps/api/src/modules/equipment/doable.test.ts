import { beforeEach, describe, expect, test } from 'bun:test'
import { Exercise, Workout, page } from '@cedo/contract'
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
})
