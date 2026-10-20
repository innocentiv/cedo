import { beforeEach, describe, expect, test } from 'bun:test'
import type { Effort, TrackingMode } from '@cedo/contract'
import { makeApi } from '../../test/harness.ts'
import { reviewFixture } from './review-fixture.ts'
import { STALL_DEPTH, type WorkingSet, stalledOf } from './stalled.ts'

/**
 * What has stalled — the same top set, three or more sessions running. Measured from the logs, in
 * every tracking mode, it reports the top set whole and in base units, with the mode that says how
 * to read it: it used to report a best weight in kg and a best reps, which the MCP formatter turned
 * back into grams with no mode, no duration and no distance — a weighted pull-up read as a 20 kg
 * lift and a plank as nothing. The rule itself is judged without a database, below.
 */

const NOTHING: Effort = { reps: null, weightG: null, durationS: null, distanceMm: null }

describe('measured from the logs', () => {
  let fixture: ReturnType<typeof reviewFixture>

  beforeEach(async () => {
    fixture = reviewFixture(await (await makeApi()).as('alice'))
  })

  type LoggedSet = Partial<Effort> & { readonly exerciseId: string }

  /** One session per set, each logging that one set. */
  async function sessionsLogging(sets: readonly LoggedSet[]): Promise<void> {
    for (const set of sets) {
      // oxlint-disable-next-line no-await-in-loop -- one session after another, as they happened.
      await fixture.aSession([set])
    }
  }

  async function threeIdenticalSessions(set: LoggedSet): Promise<void> {
    await sessionsLogging([set, set, set])
  }

  const EVERY_MODE: readonly [TrackingMode, Effort][] = [
    ['weight_reps', { ...NOTHING, reps: 8, weightG: 60_000 }],
    ['bodyweight_reps', { ...NOTHING, reps: 6, weightG: 20_000 }],
    ['bodyweight_reps', { ...NOTHING, reps: 8 }],
    ['duration', { ...NOTHING, durationS: 60 }],
    ['distance_duration', { ...NOTHING, distanceMm: 5_000_000, durationS: 1800 }],
  ]

  test.each(EVERY_MODE)(
    'a stalled %s movement reports its effort whole: %o',
    async (tracking, effort) => {
      const exerciseId = await fixture.anExercise({ tracking })
      await threeIdenticalSessions({ exerciseId, ...effort })

      expect((await fixture.review()).stalled).toEqual([
        { exercise: { name: 'Movement', tracking }, sessions: 3, effort },
      ])
    },
  )

  /** Regression: distance was once left out of the efforts compared, and a run going further read as stalled. */
  test('a run that goes further each session has not stalled', async () => {
    const exerciseId = await fixture.anExercise({ name: 'Run', tracking: 'distance_duration' })
    await sessionsLogging(
      [5_000_000, 5_500_000, 6_000_000].map((distanceMm) => ({
        exerciseId,
        distanceMm,
        durationS: 1800,
      })),
    )

    expect((await fixture.review()).stalled).toEqual([])
  })

  /** A warm-up is not work: heavier or lighter, it is never the top set, nor a session of its own. */
  test('warm-ups never count', async () => {
    const exerciseId = await fixture.anExercise()
    const set = { exerciseId, reps: 8, weightG: 60_000 }
    for (const warmUp of [100_000, 20_000, 140_000]) {
      // oxlint-disable-next-line no-await-in-loop -- one session after another, as they happened.
      await fixture.aSession([{ exerciseId, reps: 3, weightG: warmUp, isWarmup: true }, set])
    }
    // A session of warm-ups alone is no session of the exercise's work.
    await fixture.aSession([{ exerciseId, reps: 5, weightG: 20_000, isWarmup: true }])

    expect((await fixture.review()).stalled).toEqual([
      {
        exercise: { name: 'Movement', tracking: 'weight_reps' },
        sessions: 3,
        effort: { ...NOTHING, reps: 8, weightG: 60_000 },
      },
    ])
  })

  /** Read in SQL no further back than ten sessions: twelve the same report ten. */
  test('a stall is reported as far back as ten sessions, and no further', async () => {
    const exerciseId = await fixture.anExercise()
    await sessionsLogging(Array.from({ length: 12 }, () => ({ exerciseId, reps: 5 })))

    expect((await fixture.review()).stalled.map((s) => s.sessions)).toEqual([STALL_DEPTH])
  })

  test('stalled exercises come in name order', async () => {
    for (const name of ['Squat', 'Bench Press', 'deadlift']) {
      // oxlint-disable-next-line no-await-in-loop -- one exercise at a time, in a scrambled order.
      const exerciseId = await fixture.anExercise({ name })
      // oxlint-disable-next-line no-await-in-loop -- one session after another, as they happened.
      await threeIdenticalSessions({ exerciseId, reps: 5 })
    }

    expect((await fixture.review()).stalled.map((s) => s.exercise.name)).toEqual([
      'Bench Press',
      'deadlift',
      'Squat',
    ])
  })
})

/** What has stalled, from each exercise's sessions, newest first. See GLOSSARY.md, "Stalled". */
describe('what has stalled', () => {
  const bench = { name: 'Bench Press', tracking: 'weight_reps' } as const
  const lift = (reps: number, kg: number): Effort => ({ ...NOTHING, reps, weightG: kg * 1000 })
  /** `sessions[0]` the newest, each its working sets in the order logged. */
  const logged = (sessions: readonly (readonly Effort[])[]): WorkingSet[] =>
    sessions.flatMap((efforts, i) =>
      efforts.map((effort) => ({
        exerciseId: 'bench',
        exercise: bench,
        sessionId: `s${i}`,
        effort,
      })),
    )
  const three = (efforts: readonly Effort[]) => [efforts, efforts, efforts]

  test('three sessions with the same top set have stalled, however the back-off sets went', () => {
    const missedARep = [lift(8, 60), lift(8, 60), lift(7, 60)]
    expect(stalledOf(logged(three(missedARep)))).toEqual([
      { exercise: bench, sessions: 3, effort: lift(8, 60) },
    ])
  })

  test('a better top set in the latest session is progress', () => {
    expect(
      stalledOf(logged([[lift(8, 62.5)], [lift(8, 60)], [lift(8, 60)], [lift(8, 60)]])),
    ).toEqual([])
  })

  test('progress earlier, then three sessions the same, has stalled since', () => {
    const sessions = [[lift(8, 60)], [lift(8, 60)], [lift(8, 60)], [lift(8, 57.5)], [lift(8, 55)]]
    expect(stalledOf(logged(sessions))).toEqual([
      { exercise: bench, sessions: 3, effort: lift(8, 60) },
    ])
  })

  test('a bodyweight top set with no added weight is the same as one with "+0 kg"', () => {
    const pullUps = (added: number | null): WorkingSet[] =>
      [0, 1, 2].map((i) => ({
        exerciseId: 'pull-up',
        exercise: { name: 'Pull-up', tracking: 'bodyweight_reps' },
        sessionId: `s${i}`,
        effort: { ...NOTHING, reps: 8, weightG: i === 1 ? added : null },
      }))
    expect(stalledOf(pullUps(0)).map((s) => s.sessions)).toEqual([3])
  })

  test('fewer than three sessions is too few to say', () => {
    expect(stalledOf(logged([[lift(8, 60)], [lift(8, 60)]]))).toEqual([])
  })

  test('reports how long it has lasted, as far back as is read', () => {
    const sessions = Array.from({ length: STALL_DEPTH }, () => [lift(8, 60)])
    expect(stalledOf(logged(sessions))).toEqual([
      { exercise: bench, sessions: STALL_DEPTH, effort: lift(8, 60) },
    ])
  })
})
