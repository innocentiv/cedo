import { describe, expect, test } from 'bun:test'
import type { ExerciseHistory } from './log.ts'
import { MAX_ESTIMATE_REPS, estimatedMax, trendOf } from './estimate.ts'

/**
 * Estimated max (GLOSSARY.md): the most weight a set suggests could be lifted once — Epley,
 * counting the reps left in reserve as reps done (Helms et al., Front Physiol 2018).
 */
describe('the estimated max of a set', () => {
  const set = (weightG: number | null, reps: number | null, rpe: number | null = null) => ({
    weightG,
    reps,
    rpe,
  })

  test('is weight × (1 + reps / 30), with no RPE said', () => {
    expect(estimatedMax(set(60_000, 5), 'weight_reps')).toBe(70_000)
  })

  test('counts the reps left in reserve as reps done', () => {
    // RPE 8 leaves 2: as if 7 reps — 60 × (1 + 7/30) = 74 kg.
    expect(estimatedMax(set(60_000, 5, 8), 'weight_reps')).toBe(74_000)
    // At RPE 10, nothing in reserve: the same as not saying.
    expect(estimatedMax(set(60_000, 5, 10), 'weight_reps')).toBe(70_000)
  })

  test('is whole grams', () => {
    expect(Number.isInteger(estimatedMax(set(62_500, 7, 8.5), 'weight_reps'))).toBe(true)
  })

  /** Past a dozen reps the formula stops meaning a single lift. */
  test(`is none past ${MAX_ESTIMATE_REPS} reps, and none for no reps`, () => {
    expect(estimatedMax(set(40_000, MAX_ESTIMATE_REPS), 'weight_reps')).not.toBeNull()
    expect(estimatedMax(set(40_000, MAX_ESTIMATE_REPS + 1), 'weight_reps')).toBeNull()
    expect(estimatedMax(set(40_000, 0), 'weight_reps')).toBeNull()
    expect(estimatedMax(set(40_000, null), 'weight_reps')).toBeNull()
  })

  test('is none without a weight, and for anything but a weight lift', () => {
    expect(estimatedMax(set(null, 5), 'weight_reps')).toBeNull()
    expect(estimatedMax(set(0, 5), 'weight_reps')).toBeNull()
    expect(estimatedMax(set(20_000, 5), 'bodyweight_reps')).toBeNull()
  })
})

/** One point per session, oldest first, as the exercise screen draws its trend. */
describe("an exercise's trend", () => {
  const working = (weightG: number | null, reps: number | null, extra: object = {}) => ({
    setIndex: 0,
    weightG,
    reps,
    rpe: null,
    durationS: null,
    distanceMm: null,
    isWarmup: false,
    ...extra,
  })
  const history = (
    tracking: ExerciseHistory['tracking'],
    sessions: ExerciseHistory['sessions'][number]['sets'][],
  ): ExerciseHistory => ({
    exerciseId: crypto.randomUUID(),
    tracking,
    // Newest first, as the read answers.
    sessions: sessions.map((sets, i) => ({
      sessionId: crypto.randomUUID(),
      performedAt: new Date(Date.UTC(2026, 9, 20 - i)).toISOString(),
      sets,
    })),
    stalled: null,
  })

  test('for a weight lift, is each session’s best estimated max, oldest first', () => {
    const trend = trendOf(
      history('weight_reps', [
        [working(62_500, 5), working(62_500, 4)],
        [working(60_000, 5), working(65_000, 2)],
      ]),
    )
    expect(trend.map((p) => p.value)).toEqual([70_000, 72_917])
    expect(trend.every((p) => p.estimated)).toBe(true)
  })

  test('leaves warm-ups out, and a session with no set to estimate', () => {
    const trend = trendOf(
      history('weight_reps', [
        [working(100_000, 1, { isWarmup: true }), working(60_000, 5)],
        [working(40_000, 15)],
      ]),
    )
    expect(trend.map((p) => p.value)).toEqual([70_000])
  })

  test('for anything else, is the top set, measured as its mode ranks it', () => {
    const hold = (durationS: number) => ({ ...working(null, null), durationS })
    const trend = trendOf(history('duration', [[hold(60), hold(45)], [hold(40)]]))
    expect(trend.map((p) => p.value)).toEqual([40, 60])
    expect(trend.map((p) => p.estimated)).toEqual([false, false])
    expect(trend.at(-1)?.top).toMatchObject({ durationS: 60 })
  })

  test('for bodyweight work, is the added weight when any is added, the reps otherwise', () => {
    const plain = trendOf(history('bodyweight_reps', [[working(null, 12)], [working(null, 10)]]))
    expect(plain.map((p) => p.value)).toEqual([10, 12])
    const loaded = trendOf(
      history('bodyweight_reps', [[working(10_000, 6)], [working(null, 12)], [working(5_000, 8)]]),
    )
    expect(loaded.map((p) => p.value)).toEqual([5_000, 0, 10_000])
  })
})
