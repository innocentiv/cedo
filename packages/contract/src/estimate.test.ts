import { describe, expect, test } from 'bun:test'
import type { ExerciseHistory } from './history.ts'
import {
  MAX_ESTIMATE_REPS,
  estimatedMax,
  formatTrendPoint,
  pointsOf,
  trendName,
  trendOf,
} from './estimate.ts'

/**
 * Estimated max (GLOSSARY.md): the most weight a set suggests could be lifted once — Epley,
 * counting the reps left in reserve as reps done (Helms et al., Front Physiol 2018).
 */
describe('the estimated max of a set', () => {
  const set = (weightG: number | null, reps: number | null, reserve: number | null = null) => ({
    weightG,
    reps,
    reserve,
  })

  test('is weight × (1 + reps / 30), with no reserve said', () => {
    expect(estimatedMax(set(60_000, 5), 'weight_reps')).toBe(70_000)
  })

  test('counts the reps left in reserve as reps done', () => {
    // 2 in reserve: as if 7 reps — 60 × (1 + 7/30) = 74 kg.
    expect(estimatedMax(set(60_000, 5, 2), 'weight_reps')).toBe(74_000)
    // None in reserve: the same as not saying.
    expect(estimatedMax(set(60_000, 5, 0), 'weight_reps')).toBe(70_000)
  })

  /** An estimate, not a measurement: said to the nearest half kilogram, never to the gram. */
  test('is rounded to the nearest half kilogram', () => {
    // 1 in reserve, as if 8: 62.5 × (1 + 8/30) = 79.17 kg.
    expect(estimatedMax(set(62_500, 7, 1), 'weight_reps')).toBe(79_000)
    // 55 × (1 + 5/30) = 64.17 kg; 62.5 × (1 + 5/30) = 72.92 kg.
    expect(estimatedMax(set(55_000, 5), 'weight_reps')).toBe(64_000)
    expect(estimatedMax(set(62_500, 5), 'weight_reps')).toBe(73_000)
    expect(estimatedMax(set(60_500, 5), 'weight_reps')).toBe(70_500)
  })

  /** A single with none in reserve is a one-rep max lifted, not estimated: Epley would add 3%. */
  test('of a true single is the weight lifted', () => {
    expect(estimatedMax(set(100_000, 1), 'weight_reps')).toBe(100_000)
    expect(estimatedMax(set(100_000, 1, 0), 'weight_reps')).toBe(100_000)
    // One left in reserve: as if two reps.
    expect(estimatedMax(set(90_000, 1, 1), 'weight_reps')).toBe(96_000)
  })

  /** The reserve counts as reps done, so it counts toward the dozen too. */
  test(`is none past ${MAX_ESTIMATE_REPS} reps done and in reserve`, () => {
    expect(estimatedMax(set(40_000, 10, 2), 'weight_reps')).not.toBeNull()
    expect(estimatedMax(set(40_000, 12, 5), 'weight_reps')).toBeNull()
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
    // Assistance left on an exercise whose mode changed from bodyweight is no max (#19).
    expect(estimatedMax(set(-20_000, 5), 'weight_reps')).toBeNull()
  })
})

/** One point per session, oldest first, as the exercise screen draws its trend. */
describe("an exercise's trend", () => {
  const working = (weightG: number | null, reps: number | null, extra: object = {}) => ({
    setIndex: 0,
    weightG,
    reps,
    reserve: null,
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
    expect(trend.map((p) => p.value)).toEqual([70_000, 73_000])
    expect(trend.every((p) => p.estimated)).toBe(true)
  })

  test('leaves warm-ups out, and a session with no set to estimate', () => {
    const trend = pointsOf(
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

  /** Added weight and reps are not one scale: a mixed series is drawn by what every session has. */
  test('for bodyweight work, is the added weight when every session adds some, else the reps', () => {
    const plain = trendOf(history('bodyweight_reps', [[working(null, 12)], [working(null, 10)]]))
    expect(plain.map((p) => p.value)).toEqual([10, 12])
    const loaded = trendOf(history('bodyweight_reps', [[working(10_000, 6)], [working(5_000, 8)]]))
    expect(loaded.map((p) => p.value)).toEqual([5_000, 10_000])
    const mixed = trendOf(
      history('bodyweight_reps', [[working(10_000, 6)], [working(null, 12)], [working(5_000, 8)]]),
    )
    expect(mixed.map((p) => p.value)).toEqual([8, 12, 6])
  })

  /** Assisted then loaded is one scale (#19): every session with a weight draws that weight. */
  test('for bodyweight work, assistance and added weight are one line', () => {
    const climbing = trendOf(
      history('bodyweight_reps', [
        [working(5_000, 6)],
        [working(-10_000, 8)],
        [working(-20_000, 8)],
      ]),
    )
    expect(climbing.map((p) => p.value)).toEqual([-20_000, -10_000, 5_000])
  })

  /** A run ranks by distance, then by pace: over one distance, faster is progress. */
  test('for a run, is the distance — or, every run one distance, its speed', () => {
    const run = (distanceMm: number, durationS: number) => ({
      ...working(null, null),
      distanceMm,
      durationS,
    })
    const longer = trendOf(
      history('distance_duration', [[run(8_000_000, 2400)], [run(5_000_000, 1500)]]),
    )
    expect(longer.map((p) => p.value)).toEqual([5_000_000, 8_000_000])
    const faster = trendOf(
      history('distance_duration', [[run(5_000_000, 1440)], [run(5_000_000, 1500)]]),
    )
    const [slow, fast] = faster.map((p) => p.value)
    expect((fast ?? 0) > (slow ?? 0)).toBe(true)
  })

  /** One session says nothing about a direction: a trend needs two. */
  test('of a single session is none — though its point is still there to read', () => {
    const once = history('weight_reps', [[working(60_000, 5)]])
    expect(trendOf(once)).toEqual([])
    expect(pointsOf(once).map((p) => p.value)).toEqual([70_000])
  })

  test('is named and said by what it draws', () => {
    const lifts = trendOf(history('weight_reps', [[working(60_000, 5)], [working(55_000, 5)]]))
    expect(trendName(lifts)).toBe('Estimated max')
    expect(lifts.map((p) => formatTrendPoint(p, 'weight_reps', 'kg'))).toEqual(['64 kg', '70 kg'])
    const holds = trendOf(
      history('duration', [
        [{ ...working(null, null), durationS: 60 }],
        [{ ...working(null, null), durationS: 45 }],
      ]),
    )
    expect(trendName(holds)).toBe('Top set')
    expect(holds.map((p) => formatTrendPoint(p, 'duration', 'kg'))).toEqual(['0:45', '1:00'])
  })
})
