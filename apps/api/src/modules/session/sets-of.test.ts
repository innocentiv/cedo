import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { kgToG } from '@cedo/contract'
import { db } from '../../db/client.ts'
import { resolveCaller } from '../../plugins/auth.ts'
import { coachedSquad } from '../../test/coaching.ts'
import { type TestApi, type TestUser, makeApi } from '../../test/harness.ts'
import { reviewFixture } from '../../test/review-fixture.ts'
import { type Training, own, ownOrCoached } from '../coaching/training.ts'
import { liftedOf, setsOf } from './sets-of.ts'

/**
 * The sets of a training (`setsOf`): whose they are, said once, and what each carries of its
 * session — and what a set lifted (`liftedOf`). That each reader reads what it should through it is
 * the readers' own tests'; that it plans as the raw join does is `bun run perf`'s.
 */

let h: TestApi

beforeEach(async () => {
  h = await makeApi()
})

const callerOf = async (user: TestUser) => {
  const caller = await resolveCaller(`Bearer ${user.token}`)
  if (caller === null) throw new Error(`${user.username} could not be resolved`)
  return caller
}

const set = (exerciseId: string, kg: number, reps: number, isWarmup = false) => ({
  exerciseId,
  weightG: kgToG(kg),
  reps,
  reserve: null,
  isWarmup,
})

/** Every set of `training`, with what it carries of its session and what it lifted. */
async function read(training: Training) {
  const sets = setsOf(training)
  return await db
    .select({
      reps: sets.reps,
      isWarmup: sets.isWarmup,
      startedAt: sets.startedAt,
      endedAt: sets.endedAt,
      lifted: sql<number>`${liftedOf(sets)}`.mapWith(Number),
    })
    .from(sets)
    .orderBy(sets.reps)
}

describe('the sets of a training', () => {
  test('are the athlete’s own, and none of anyone else’s', async () => {
    const alice = await h.as('alice')
    const bob = await h.as('bob')
    const squat = await reviewFixture(alice).anExercise({ name: 'Squat' })
    const bench = await reviewFixture(bob).anExercise({ name: 'Bench' })
    await reviewFixture(alice).aSession([set(squat, 100, 5), set(squat, 100, 6)])
    await reviewFixture(bob).aSession([set(bench, 60, 8)])

    expect((await read(own(await callerOf(alice)))).map((s) => s.reps)).toEqual([5, 6])
    expect((await read(own(await callerOf(bob)))).map((s) => s.reps)).toEqual([8])
  })

  /** A coach reads their athlete's through the athlete's training (ADR-0021), and their own as theirs. */
  test('read by a coach, are the athlete’s through their training', async () => {
    const { coach, athlete } = await coachedSquad(h)
    const squat = await reviewFixture(athlete).anExercise({ name: 'Squat' })
    await reviewFixture(athlete).aSession([set(squat, 100, 5)])
    const coachCaller = await callerOf(coach)

    const theirs = await ownOrCoached(coachCaller, (await callerOf(athlete)).userId)
    expect((await read(theirs)).map((s) => s.reps)).toEqual([5])
    expect(await read(own(coachCaller))).toEqual([])
  })

  test('each carry their session’s start and end, warm-ups among them, marked', async () => {
    const alice = await h.as('alice')
    const squat = await reviewFixture(alice).anExercise({ name: 'Squat' })
    await reviewFixture(alice).aSession([set(squat, 60, 3, true), set(squat, 100, 5)])

    const sets = await read(own(await callerOf(alice)))
    expect(sets.map((s) => [s.reps, s.isWarmup])).toEqual([
      [3, true],
      [5, false],
    ])
    for (const s of sets) {
      expect(s.startedAt).toBeInstanceOf(Date)
      // Finished, as the fixture's sessions are.
      expect(s.endedAt).toBeInstanceOf(Date)
    }
  })
})

describe('what a set lifted', () => {
  test('is its weight times its reps, in grams', async () => {
    const alice = await h.as('alice')
    const squat = await reviewFixture(alice).anExercise({ name: 'Squat' })
    await reviewFixture(alice).aSession([set(squat, 100, 5)])
    expect((await read(own(await callerOf(alice)))).map((s) => s.lifted)).toEqual([kgToG(500)])
  })

  /** Negative added weight is assistance (#19): help, not load. */
  test('is nothing for an assisted set', async () => {
    const alice = await h.as('alice')
    const dip = await reviewFixture(alice).anExercise({ name: 'Dip', tracking: 'bodyweight_reps' })
    await reviewFixture(alice).aSession([set(dip, -10, 8)])
    expect((await read(own(await callerOf(alice)))).map((s) => s.lifted)).toEqual([0])
  })

  /**
   * A bigint, so what is made of it does not overflow int4: the review's share of a muscle,
   * 500 kg × 50 reps × 100%, is 2.5e9 against a 2.147e9 ceiling — once a 500 for the whole review.
   */
  test('is a number the review can multiply by a muscle’s share without overflowing', async () => {
    const alice = await h.as('alice')
    const sled = await reviewFixture(alice).anExercise({ name: 'Sled' })
    await reviewFixture(alice).aSession([set(sled, 500, 50)])
    const sets = setsOf(own(await callerOf(alice)))
    const [row] = await db
      .select({ share: sql<number>`${liftedOf(sets)} * 100`.mapWith(Number) })
      .from(sets)
    expect(row?.share).toBe(2_500_000_000)
  })
})
