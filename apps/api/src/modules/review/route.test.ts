import { beforeEach, describe, expect, test } from 'bun:test'
import { TrainingReview, Workout, WorkoutSession, kgToG } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { reviewFixture } from '../../test/review-fixture.ts'

/**
 * `GET /review` (#28): the review `training_review` gives an AI, for the athlete's own Progress tab
 * — every part of it said by the contract, so the app reads what the route answers.
 */

let h: TestApi
let alice: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
})

const set = (exerciseId: string, kg: number, reserve: number | null = null) => ({
  exerciseId,
  weightG: kgToG(kg),
  reps: 5,
  reserve,
})

describe('your training, reviewed over HTTP', () => {
  test('answers every part as the contract says it, a stall among them', async () => {
    const fixture = reviewFixture(alice)
    const stuck = await fixture.anExercise({ name: 'Row' })
    const sliding = await fixture.anExercise({ name: 'Bench' })
    // Oldest first: the row at 80 kg four times running, which has stalled; the bench beside it.
    for (const [daysAgo, benchKg, reserve] of [
      [20, 66, 3],
      [14, 63, 2],
      [7, 60, 1],
      [1, 60, 0],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- in order: each session is a day of its own.
      await fixture.aSession([set(stuck, 80), set(sliding, benchKg, reserve)], daysAgo)
    }

    const res = await alice.wire('/review?weeks=4')
    const review = expectContract(TrainingReview, res.body)
    expect(review.weeks).toBe(4)
    expect(review.adherence.sessions).toBe(4)
    expect(review.stalled.map((s) => s.exercise.name)).toContain('Row')
    expect(review.muscleWork.top.map((m) => m.muscle)).toContain('latissimus_dorsi')
  })

  /** Days skipped (#28): a planned day never trained is the one most worth seeing. */
  test('lists every planned day of a workout trained, a day never trained at none', async () => {
    const fixture = reviewFixture(alice)
    const lift = await fixture.anExercise({ name: 'Lift' })
    const created = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'AB' }) }))
        .body,
    )
    const day = (name: string) => ({
      name,
      entries: [{ exerciseId: lift, sets: [{ targetReps: 5 }] }],
    })
    const plan = expectContract(
      Workout,
      (
        await alice.wire(`/workouts/${created.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify({ days: [day('A'), day('B')] }),
        })
      ).body,
    )
    const session = expectContract(
      WorkoutSession,
      (
        await alice.wire('/sessions', {
          method: 'POST',
          body: JSON.stringify({ workoutId: plan.id, dayId: plan.days[0]?.id }),
        })
      ).body,
    )
    await alice.wire(`/sessions/${session.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ endedAt: new Date().toISOString() }),
    })
    const review = expectContract(TrainingReview, (await alice.wire('/review?weeks=4')).body)
    expect(review.dayBalance).toEqual([
      { day: 'A', workout: 'AB', sessions: 1 },
      { day: 'B', workout: 'AB', sessions: 0 },
    ])
  })

  /** What a plan is weighed against (#42): their bodyweight over the period, and their age. */
  test('says their bodyweight, its change over the period, and their age — never the year', async () => {
    const send = async (path: string, body: unknown, method = 'POST') =>
      await alice.wire(path, { method, body: JSON.stringify(body) })
    const blank = expectContract(TrainingReview, (await alice.wire('/review?weeks=4')).body)
    expect(blank).toMatchObject({ bodyweight: null, age: null })

    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
    for (const [ago, weightG] of [
      [40, 84_000],
      [20, 83_000],
      [2, 82_400],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one a day, each its own.
      await send('/weigh-ins', { day: day(ago), weightG })
    }
    await send('/auth/me', { birthYear: 1990 }, 'PATCH')
    const review = expectContract(TrainingReview, (await alice.wire('/review?weeks=4')).body)
    expect(review.bodyweight).toEqual({
      latest: { day: day(2), weightG: 82_400 },
      from: { day: day(40), weightG: 84_000 },
    })
    expect(review.age).toBe(new Date().getFullYear() - 1990)
    expect(JSON.stringify(review)).not.toContain('1990')
  })

  test('looks back eight weeks unless asked, and no more than a year', async () => {
    const review = expectContract(TrainingReview, (await alice.wire('/review')).body)
    expect(review.weeks).toBe(8)
    expect((await alice.wire('/review?weeks=53')).status).toBe(422)
  })
})
