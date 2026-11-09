import { beforeEach, describe, expect, test } from 'bun:test'
import type { LoggedExercise } from '@cedo/contract'
import { makeApi } from '../../test/harness.ts'
import { reviewFixture } from '../../test/review-fixture.ts'
import { effortDriftOf, fallingOf } from './deload.ts'
import type { WorkingSet } from './stalled.ts'

/**
 * The deload signals `training_review` gives the AI, which deloads by saving the plan (ADR-0012):
 * performance down across sessions, and effort up at the same load (Bell et al., Sports Med Open
 * 2023 — expert consensus). Pure: sets in, signals out.
 */

const bench: LoggedExercise = { name: 'Bench', tracking: 'weight_reps' }

/** Sessions of one exercise, newest first, each a list of `[weightKg, reps, reserve]`. */
function logged(
  sessions: readonly (readonly [number, number, number | null])[][],
  exercise: LoggedExercise = bench,
): WorkingSet[] {
  return sessions.flatMap((sets, s) =>
    sets.map(([weightKg, reps, reserve]) => ({
      exerciseId: exercise.name,
      exercise,
      sessionId: `session-${s}`,
      effort: { weightG: weightKg * 1000, reps, durationS: null, distanceMm: null, reserve },
    })),
  )
}

describe('falling', () => {
  // Five reps estimate 7/6 of the weight: 60 → 70 kg, 63 → 73.5 kg, 66 → 77 kg.
  test('is the estimated max lower in each of the latest two sessions or more', () => {
    const sets = logged([[[60, 5, null]], [[63, 5, null]], [[66, 5, null]], [[60, 5, null]]])
    expect(fallingOf(sets)).toEqual([{ exercise: bench, sessions: 2, fromG: 77_000, toG: 70_000 }])
  })

  test('is not one bad session', () => {
    expect(fallingOf(logged([[[60, 5, null]], [[63, 5, null]], [[60, 5, null]]]))).toEqual([])
  })

  test('is not a session that held', () => {
    expect(
      fallingOf(logged([[[60, 5, null]], [[60, 5, null]], [[63, 5, null]], [[66, 5, null]]])),
    ).toEqual([])
  })

  /**
   * What was lifted, not how it was rated: the same 60 × 5 said with a rep less in reserve each
   * time estimates 76, 74, 72 kg with the reserve counted — a "fall" made of rating noise, and the
   * very thing effort drift reads, said twice.
   */
  test('is not the same set rated harder', () => {
    expect(fallingOf(logged([[[60, 5, 1]], [[60, 5, 2]], [[60, 5, 3]]]))).toEqual([])
  })

  test('is not a fall that has already turned', () => {
    expect(
      fallingOf(logged([[[66, 5, null]], [[60, 5, null]], [[63, 5, null]], [[66, 5, null]]])),
    ).toEqual([])
  })

  /** Only a weight lift has an estimated max to fall. */
  test('is a weight lift’s only', () => {
    const plank: LoggedExercise = { name: 'Plank', tracking: 'duration' }
    const holds = [60, 50, 40].map((durationS, s) => ({
      exerciseId: 'plank',
      exercise: plank,
      sessionId: `session-${s}`,
      effort: { weightG: null, reps: null, durationS, distanceMm: null, reserve: null },
    }))
    expect(fallingOf(holds)).toEqual([])
  })
})

describe('effort drift', () => {
  /**
   * Each session weighs the same: the two-set session before averages 2 in reserve, and the two
   * sessions 2.5 — not 2.3, its two sets two votes of three. An average may be a fraction; a rating
   * is whole.
   */
  test('is the reserve down by 1 or more at the same set, in each of the latest two sessions', () => {
    const sets = logged([
      [
        [60, 5, 1],
        [60, 5, 1],
      ],
      [[60, 5, 1]],
      [[60, 5, 3]],
      [
        [60, 5, 1],
        [60, 5, 3],
      ],
    ])
    expect(effortDriftOf(sets)).toEqual([
      {
        exercise: bench,
        effort: { weightG: 60_000, reps: 5, durationS: null, distanceMm: null },
        fromReserve: 2.5,
        toReserve: 1,
      },
    ])
  })

  /** A self-reported reserve is off by about one (Halperin et al., Sports Med 2022). */
  test('is not one hard set alone, nor one hard session', () => {
    const oneSet = logged([
      [
        [60, 5, 0],
        [60, 5, 3],
      ],
      [[60, 5, 3]],
      [[60, 5, 3]],
    ])
    expect(effortDriftOf(oneSet)).toEqual([])
    const oneSession = logged([
      [
        [60, 5, 1],
        [60, 5, 1],
      ],
      [[60, 5, 3]],
      [[60, 5, 3]],
    ])
    expect(effortDriftOf(oneSession)).toEqual([])
  })

  /** A heavier set is harder; that is the load, not drift. */
  test('compares only the same set — not a heavier one, nor more reps', () => {
    const sets = logged([[[65, 5, 1]], [[60, 6, 1]], [[60, 5, 3]], [[60, 5, 3]]])
    expect(effortDriftOf(sets)).toEqual([])
  })

  test('needs a reserve said, before and since', () => {
    const sets = logged([[[60, 5, 1]], [[60, 5, 1]], [[60, 5, null]]])
    expect(effortDriftOf(sets)).toEqual([])
  })
})

/** Through the review, from the logs: both signals beside the stall, read from the same sessions. */
describe('in the training review', () => {
  let fixture: ReturnType<typeof reviewFixture>

  beforeEach(async () => {
    fixture = reviewFixture(await (await makeApi()).as('alice'))
  })

  test('a lift falling, and one drifting, are said', async () => {
    const falling = await fixture.anExercise({ name: 'Bench' })
    const drifting = await fixture.anExercise({ name: 'Row' })
    // Oldest first, as they happened: the bench 66, 63, 60, 57 kg; the row's reserve 3, 3, 1, 1.
    for (const [benchKg, rowReserve] of [
      [66, 3],
      [63, 3],
      [60, 1],
      [57, 1],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one session after another, as they happened.
      await fixture.aSession([
        { exerciseId: falling, weightG: benchKg * 1000, reps: 5 },
        { exerciseId: drifting, weightG: 50_000, reps: 8, reserve: rowReserve },
      ])
    }

    const review = await fixture.review()
    expect(review.falling.map((f) => [f.exercise.name, f.sessions])).toEqual([['Bench', 3]])
    expect(review.effortDrift.map((d) => [d.exercise.name, d.fromReserve, d.toReserve])).toEqual([
      ['Row', 3, 1],
    ])
  })
})
