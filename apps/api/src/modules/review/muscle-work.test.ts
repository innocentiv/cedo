import { beforeEach, describe, expect, test } from 'bun:test'
import { makeApi } from '../../test/harness.ts'
import { DECLINE_FROM_SETS, TOP_MUSCLES, type WindowWork, muscleWorkOf } from './muscle-work.ts'
import { reviewFixture } from './review-fixture.ts'

/**
 * The work each muscle got, in working sets by load share. It used to be weight × reps alone, which
 * a plank, a run or an unweighted pull-up cannot register: a muscle trained only by those read
 * "0 kg", as if it had not been trained at all. See GLOSSARY.md, "Working sets per muscle".
 */
describe('measured from the logs', () => {
  let fixture: ReturnType<typeof reviewFixture>

  beforeEach(async () => {
    fixture = reviewFixture(await (await makeApi()).as('alice'))
  })

  const workOf = async (muscle: string) => {
    const { top, declined } = (await fixture.review()).muscleWork
    return [...top, ...declined].find((m) => m.muscle === muscle)
  }

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
})

/** What the review names, from each window's work. See GLOSSARY.md, "Declined muscle". */
describe('what is worth saying', () => {
  const work = (muscle: string, sets: number, lifted = 0): WindowWork => ({ muscle, sets, lifted })
  /** `count` muscles, `m0` the most worked. */
  const worked = (count: number, from = 0): WindowWork[] =>
    Array.from({ length: count }, (_, i) => work(`m${from + i}`, 100 - from - i))
  const names = (list: readonly { muscle: string }[]) => list.map((m) => m.muscle)

  test('names the most-worked muscles, most first, and counts the rest', () => {
    const review = muscleWorkOf(worked(TOP_MUSCLES + 3), [])
    expect(names(review.top)).toEqual(names(worked(TOP_MUSCLES)))
    expect(review.omitted).toBe(3)
  })

  test('names a declined muscle however many others worked more', () => {
    const review = muscleWorkOf(worked(TOP_MUSCLES + 1), [work('declined', 6)])
    expect(review.declined).toEqual([
      { muscle: 'declined', weightedSets: 0, liftedG: 0, changePct: -100, declined: true },
    ])
    expect(review.omitted).toBe(1)
  })

  test('a fall to exactly half is a decline; just above half is not', () => {
    const review = muscleWorkOf(
      [...worked(TOP_MUSCLES), work('half', 2), work('more', 2.1)],
      [work('half', 4), work('more', 4)],
    )
    expect(names(review.declined)).toEqual(['half'])
    expect(review.omitted).toBe(1)
  })

  test('a muscle with fewer sets before than the floor never declines — its fall is noise', () => {
    const review = muscleWorkOf(worked(TOP_MUSCLES), [
      work('incidental', DECLINE_FROM_SETS - 0.1),
      work('trained', DECLINE_FROM_SETS),
    ])
    expect(names(review.declined)).toEqual(['trained'])
    expect(review.omitted).toBe(1)
  })

  test('a top muscle that declined is named once, in the top, where its change says so', () => {
    const review = muscleWorkOf([work('squat', 3)], [work('squat', 10)])
    expect(review.top).toEqual([
      { muscle: 'squat', weightedSets: 3, liftedG: 0, changePct: -70, declined: true },
    ])
    expect(review.declined).toEqual([])
  })

  test('with room to spare, a muscle with no work now is named too, after the worked ones', () => {
    const review = muscleWorkOf([work('squat', 3)], [work('calves', 1)])
    expect(review.top).toEqual([
      { muscle: 'squat', weightedSets: 3, liftedG: 0, changePct: null, declined: false },
      // Too little before to call a decline (`DECLINE_FROM_SETS`).
      { muscle: 'calves', weightedSets: 0, liftedG: 0, changePct: -100, declined: false },
    ])
    expect(review.omitted).toBe(0)
  })

  /**
   * By sets LOST — not by sets before, nor by the steepest fall: each of those orders these three
   * differently.
   */
  test('declines come most sets lost first', () => {
    const review = muscleWorkOf(
      [...worked(TOP_MUSCLES), work('twentyToTen', 10), work('tenToFive', 5)],
      [work('twentyToTen', 20), work('eightToNone', 8), work('tenToFive', 10)],
    )
    expect(names(review.declined)).toEqual(['twentyToTen', 'eightToNone', 'tenToFive'])
  })
})
