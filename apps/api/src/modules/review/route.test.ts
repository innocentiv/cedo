import { beforeEach, describe, expect, test } from 'bun:test'
import { TrainingReview, Workout, WorkoutSession, kgToG } from '@cedo/contract'
import { expectContract } from '../../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { reviewFixture } from './review-fixture.ts'

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

const set = (exerciseId: string, kg: number, rpe: number | null = null) => ({
  exerciseId,
  weightG: kgToG(kg),
  reps: 5,
  rpe,
})

describe('your training, reviewed over HTTP', () => {
  test('answers every part as the contract says it, a stall among them', async () => {
    const fixture = reviewFixture(alice)
    const stuck = await fixture.anExercise({ name: 'Row' })
    const sliding = await fixture.anExercise({ name: 'Bench' })
    // Oldest first: the row at 80 kg four times running, which has stalled; the bench beside it.
    for (const [daysAgo, benchKg, rpe] of [
      [20, 66, 7],
      [14, 63, 8],
      [7, 60, 9],
      [1, 60, 10],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- in order: each session is a day of its own.
      await fixture.aSession([set(stuck, 80), set(sliding, benchKg, rpe)], daysAgo)
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

  test('looks back eight weeks unless asked, and no more than a year', async () => {
    const review = expectContract(TrainingReview, (await alice.wire('/review')).body)
    expect(review.weeks).toBe(8)
    expect((await alice.wire('/review?weeks=53')).status).toBe(422)
  })
})
