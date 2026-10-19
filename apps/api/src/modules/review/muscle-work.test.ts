import { beforeEach, expect, test } from 'bun:test'
import { makeApi } from '../../test/harness.ts'
import { reviewFixture } from './review-fixture.ts'

/**
 * The work each muscle got, in working sets by load share. It used to be weight × reps alone, which
 * a plank, a run or an unweighted pull-up cannot register: a muscle trained only by those read
 * "0 kg", as if it had not been trained at all. See GLOSSARY.md, "Working sets per muscle".
 */

let fixture: ReturnType<typeof reviewFixture>

beforeEach(async () => {
  fixture = reviewFixture(await (await makeApi()).as('alice'))
})

const workOf = async (muscle: string) =>
  (await fixture.review()).muscleWork.find((m) => m.muscle === muscle)

test('work with no load counts as the sets it was, with nothing lifted', async () => {
  const plank = await fixture.anExercise({
    name: 'Plank',
    tracking: 'duration',
    muscles: [{ muscle: 'rectus_abdominis', loadPct: 100 }],
  })
  const pullUp = await fixture.anExercise({ name: 'Pull-up', tracking: 'bodyweight_reps' })
  await fixture.aSession([
    { exerciseId: plank, durationS: 60 },
    { exerciseId: plank, durationS: 60 },
    { exerciseId: plank, durationS: 60 },
    { exerciseId: pullUp, reps: 8 },
    { exerciseId: pullUp, reps: 8 },
  ])

  expect(await workOf('rectus_abdominis')).toMatchObject({ weightedSets: 3, liftedG: 0 })
  expect(await workOf('latissimus_dorsi')).toMatchObject({ weightedSets: 2, liftedG: 0 })
})

test('a set counts toward each muscle by its share of the load', async () => {
  const bench = await fixture.anExercise({
    name: 'Bench',
    muscles: [
      { muscle: 'pectoralis_major', loadPct: 70 },
      { muscle: 'triceps_brachii', loadPct: 30 },
    ],
  })
  await fixture.aSession([{ exerciseId: bench, weightG: 100_000, reps: 5 }])

  expect(await workOf('pectoralis_major')).toMatchObject({ weightedSets: 0.7, liftedG: 350_000 })
  expect(await workOf('triceps_brachii')).toMatchObject({ weightedSets: 0.3, liftedG: 150_000 })
})

test('a warm-up is not work', async () => {
  const squat = await fixture.anExercise({
    name: 'Squat',
    muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
  })
  await fixture.aSession([
    { exerciseId: squat, weightG: 40_000, reps: 5, isWarmup: true },
    { exerciseId: squat, weightG: 100_000, reps: 5 },
  ])

  expect(await workOf('quadriceps')).toMatchObject({ weightedSets: 1, liftedG: 500_000 })
})

/**
 * The trend compares SETS, so work with no load has one: two sets of planks before, three now, is
 * half as much again. Compared by weight lifted, a plank-only muscle would never have a trend at
 * all — "no prior data", forever.
 */
test('the trend compares sets, so unloaded work has one too', async () => {
  const plank = await fixture.anExercise({
    name: 'Plank',
    tracking: 'duration',
    muscles: [{ muscle: 'rectus_abdominis', loadPct: 100 }],
  })
  // Five weeks back: inside the four weeks before the four reviewed.
  await fixture.aSession(
    [
      { exerciseId: plank, durationS: 60 },
      { exerciseId: plank, durationS: 60 },
    ],
    35,
  )
  await fixture.aSession([
    { exerciseId: plank, durationS: 60 },
    { exerciseId: plank, durationS: 60 },
    { exerciseId: plank, durationS: 60 },
  ])

  expect(await workOf('rectus_abdominis')).toMatchObject({ weightedSets: 3, changePct: 50 })
})
