import { beforeEach, describe, expect, test } from 'bun:test'
import type { LoggedExercise } from '@cedo/contract'
import { makeApi } from '../../test/harness.ts'
import { effortDriftOf, fallingOf } from './deload.ts'
import { reviewFixture } from './review-fixture.ts'
import type { WorkingSet } from './stalled.ts'

/**
 * The deload signals `training_review` gives the AI, which deloads by saving the plan (ADR-0012):
 * performance down across sessions, and effort up at the same load (Bell et al., Sports Med Open
 * 2023 — expert consensus). Pure: sets in, signals out.
 */

const bench: LoggedExercise = { name: 'Bench', tracking: 'weight_reps' }

/** Sessions of one exercise, newest first, each a list of `[weightKg, reps, rpe]`. */
function logged(
  sessions: readonly (readonly [number, number, number | null])[][],
  exercise: LoggedExercise = bench,
): WorkingSet[] {
  return sessions.flatMap((sets, s) =>
    sets.map(([weightKg, reps, rpe]) => ({
      exerciseId: exercise.name,
      exercise,
      sessionId: `session-${s}`,
      effort: { weightG: weightKg * 1000, reps, durationS: null, distanceMm: null, rpe },
    })),
  )
}

describe('falling', () => {
  // Five reps estimate 7/6 of the weight: 60 → 70 kg, 63 → 73.5 kg, 66 → 77 kg.
  test('is the estimated max lower in each of the latest two sessions or more', () => {
    const sets = logged([[[60, 5, null]], [[63, 5, null]], [[66, 5, null]], [[60, 5, null]]])
    expect(fallingOf(sets)).toEqual([{ exercise: bench, sessions: 2, from: 77_000, to: 70_000 }])
  })

  test('is not one bad session', () => {
    expect(fallingOf(logged([[[60, 5, null]], [[63, 5, null]], [[60, 5, null]]]))).toEqual([])
  })

  test('is not a session that held', () => {
    expect(
      fallingOf(logged([[[60, 5, null]], [[60, 5, null]], [[63, 5, null]], [[66, 5, null]]])),
    ).toEqual([])
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
      effort: { weightG: null, reps: null, durationS, distanceMm: null, rpe: null },
    }))
    expect(fallingOf(holds)).toEqual([])
  })
})

describe('effort drift', () => {
  test('is RPE up by 1 or more at the same set, in each of the latest two sessions', () => {
    const sets = logged([
      [
        [60, 5, 8.5],
        [60, 5, 8.5],
      ],
      [[60, 5, 8.5]],
      [[60, 5, 7]],
      [
        [60, 5, 7.5],
        [60, 5, 7],
      ],
    ])
    expect(effortDriftOf(sets)).toEqual([
      {
        exercise: bench,
        effort: { weightG: 60_000, reps: 5, durationS: null, distanceMm: null },
        from: 7.2,
        to: 8.5,
      },
    ])
  })

  /** Self-reported RPE is off by about one (Halperin et al., Sports Med 2022): one set says little. */
  test('is not one hard set alone, nor one hard session', () => {
    const oneSet = logged([
      [
        [60, 5, 10],
        [60, 5, 7],
      ],
      [[60, 5, 7]],
      [[60, 5, 7]],
    ])
    expect(effortDriftOf(oneSet)).toEqual([])
    const oneSession = logged([
      [
        [60, 5, 9],
        [60, 5, 9],
      ],
      [[60, 5, 7]],
      [[60, 5, 7]],
    ])
    expect(effortDriftOf(oneSession)).toEqual([])
  })

  /** A heavier set is harder; that is the load, not drift. */
  test('compares only the same set — not a heavier one, nor more reps', () => {
    const sets = logged([[[65, 5, 9]], [[60, 6, 9]], [[60, 5, 7]], [[60, 5, 7]]])
    expect(effortDriftOf(sets)).toEqual([])
  })

  test('needs RPE said, before and since', () => {
    const sets = logged([[[60, 5, 9]], [[60, 5, 9]], [[60, 5, null]]])
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
    // Oldest first, as they happened: the bench 66, 63, 60, 57 kg; the row's RPE 7, 7, 8.5, 8.5.
    for (const [benchKg, rowRpe] of [
      [66, 7],
      [63, 7],
      [60, 8.5],
      [57, 8.5],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one session after another, as they happened.
      await fixture.aSession([
        { exerciseId: falling, weightG: benchKg * 1000, reps: 5 },
        { exerciseId: drifting, weightG: 50_000, reps: 8, rpe: rowRpe },
      ])
    }

    const review = await fixture.review()
    expect(review.falling.map((f) => [f.exercise.name, f.sessions])).toEqual([['Bench', 3]])
    expect(review.effortDrift.map((d) => [d.exercise.name, d.from, d.to])).toEqual([
      ['Row', 7, 8.5],
    ])
  })
})
