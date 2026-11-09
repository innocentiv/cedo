import { type Effort, formatEffort, topSet } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { ExerciseHistory } from './history.ts'
import { type WeightUnit, formatWeight, roundToIncrement } from './units.ts'

/**
 * Estimated max (GLOSSARY.md): the most weight a set suggests could be lifted once, from its
 * weight, its reps and the reps it left in reserve — so sets of different rep counts compare.
 * Epley's formula, counting the reserve as reps done (Helms et al., Front Physiol 2018; Hickmott et
 * al., Sports Med Open 2022). With no reserve said, nothing is counted in reserve.
 */

/** Past a dozen reps the formula stops meaning a single lift: such a set estimates nothing. */
export const MAX_ESTIMATE_REPS = 12

/**
 * An estimate is said to the nearest half kilogram: precision it does not have — "64.17 kg" — would
 * read as a measurement. A single lifted is no estimate, and keeps its weight.
 */
const ESTIMATE_STEP_G = 500

/**
 * In grams; null for a set it cannot estimate — not a weight lift, no weight, or past
 * `MAX_ESTIMATE_REPS` reps done and in reserve, which the formula counts alike. A true single — one
 * rep, none in reserve — is the weight itself: a one-rep max lifted, where Epley would add 3%.
 */
export function estimatedMax(
  set: {
    readonly weightG: number | null
    readonly reps: number | null
    readonly reserve: number | null
  },
  tracking: TrackingMode,
): number | null {
  const { weightG, reps, reserve } = set
  // Not positive: no load to estimate from — and a negative one is assistance left behind by an
  // exercise whose mode changed from bodyweight (#19), never a max.
  if (tracking !== 'weight_reps' || weightG === null || weightG <= 0) return null
  if (reps === null || reps < 1) return null
  const done = reps + (reserve ?? 0)
  if (done > MAX_ESTIMATE_REPS) return null
  return done === 1 ? weightG : roundToIncrement(weightG * (1 + done / 30), ESTIMATE_STEP_G)
}

/** One session on an exercise's trend: what it reached, and the set that reached it. */
export interface TrendPoint {
  readonly sessionId: string
  readonly performedAt: string
  /**
   * What the trend draws: the best estimated max in grams for a weight lift; for anything else, the
   * top set's measure as its mode ranks it — see `MEASURE`.
   */
  readonly value: number
  /** Whether `value` is an estimated max, or the top set's own measure. */
  readonly estimated: boolean
  /** The session's top set (`topSet`), as logged. */
  readonly top: Effort
}

/** One session says nothing about a direction: a trend is two points or more. */
const MIN_TREND_POINTS = 2

/**
 * Each session's point, oldest first. Warm-ups never count. A weight lift's session with no set to
 * estimate has no point: it is not a zero. Every point, however few — what a history line reads.
 */
export function pointsOf(history: ExerciseHistory): TrendPoint[] {
  const { tracking } = history
  const sessions = history.sessions.flatMap((s) => {
    const sets = s.sets.filter((set) => !set.isWarmup)
    const top = topSet(sets, tracking)
    return top === undefined ? [] : [{ ...s, sets, top }]
  })
  const measure = MEASURE[tracking](sessions.map((s) => s.top))

  return sessions
    .flatMap((s): TrendPoint[] => {
      const at = { sessionId: s.sessionId, performedAt: s.performedAt, top: s.top }
      if (tracking !== 'weight_reps') return [{ ...at, value: measure(s.top), estimated: false }]
      const estimates = s.sets.flatMap((set) => estimatedMax(set, tracking) ?? [])
      return estimates.length === 0
        ? []
        : [{ ...at, value: Math.max(...estimates), estimated: true }]
    })
    .toReversed()
}

/** The points as a trend: none, under `MIN_TREND_POINTS`. */
export function trendOf(history: ExerciseHistory): TrendPoint[] {
  const points = pointsOf(history)
  return points.length < MIN_TREND_POINTS ? [] : points
}

/** What a trend is of, said as its heading. */
export const trendName = (points: readonly TrendPoint[]): string =>
  points.at(-1)?.estimated === true ? 'Estimated max' : 'Top set'

/** A point, said: an estimated max as a weight; any other, its top set as its mode measures it. */
export const formatTrendPoint = (
  point: TrendPoint,
  tracking: TrackingMode,
  unit: WeightUnit,
): string =>
  point.estimated ? formatWeight(point.value, unit) : formatEffort(point.top, tracking, unit)

/**
 * How a series of top sets is drawn, decided over the whole series — one per mode, or this does not
 * compile. A weight lift is estimated before it gets here. Bodyweight work by its weight — added
 * load, or assistance as negative (#19), one scale — when every session has one; weight and reps
 * are not one scale, so else by reps. A run by
 * distance, as it ranks first; every run one distance, by speed — the farthest, then the fastest.
 */
const MEASURE: {
  readonly [M in TrackingMode]: (tops: readonly Effort[]) => (top: Effort) => number
} = {
  weight_reps: () => (top) => top.weightG ?? 0,
  // Assistance is negative added weight (#19), one scale with load: drawn when every session has one.
  bodyweight_reps: (tops) =>
    tops.every((t) => (t.weightG ?? 0) !== 0) ? (top) => top.weightG ?? 0 : (top) => top.reps ?? 0,
  duration: () => (top) => top.durationS ?? 0,
  distance_duration: (tops) => {
    const [first] = tops
    const oneDistance = tops.every(
      (t) => t.distanceMm === first?.distanceMm && (t.durationS ?? 0) > 0,
    )
    return oneDistance
      ? (top) => Math.round((top.distanceMm ?? 0) / (top.durationS ?? 1))
      : (top) => top.distanceMm ?? 0
  },
}
