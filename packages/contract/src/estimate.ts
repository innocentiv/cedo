import { type Effort, topSet } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { ExerciseHistory } from './log.ts'
import { reserveOf } from './rpe.ts'

/**
 * Estimated max (GLOSSARY.md): the most weight a set suggests could be lifted once, from its
 * weight, its reps and the reps it left in reserve — so sets of different rep counts compare.
 * Epley's formula, counting the reserve as reps done (Helms et al., Front Physiol 2018; Hickmott et
 * al., Sports Med Open 2022). With no RPE said, nothing is counted in reserve.
 */

/** Past a dozen reps the formula stops meaning a single lift: such a set estimates nothing. */
export const MAX_ESTIMATE_REPS = 12

/** In grams; null for a set it cannot estimate — not a weight lift, no weight, or out of range. */
export function estimatedMax(
  set: {
    readonly weightG: number | null
    readonly reps: number | null
    readonly rpe: number | null
  },
  tracking: TrackingMode,
): number | null {
  const { weightG, reps, rpe } = set
  if (tracking !== 'weight_reps' || weightG === null || weightG === 0) return null
  if (reps === null || reps < 1 || reps > MAX_ESTIMATE_REPS) return null
  const reserve = rpe === null ? 0 : reserveOf(rpe)
  return Math.round(weightG * (1 + (reps + reserve) / 30))
}

/** One session on an exercise's trend: what it reached, and the set that reached it. */
export interface TrendPoint {
  readonly sessionId: string
  readonly performedAt: string
  /**
   * What the trend draws: the best estimated max in grams for a weight lift; for anything else, the
   * top set's measure as its mode ranks it — added weight, else reps; a hold's seconds; a distance.
   */
  readonly value: number
  /** Whether `value` is an estimated max, or the top set's own measure. */
  readonly estimated: boolean
  /** The session's top set (`topSet`), as logged. */
  readonly top: Effort
}

/**
 * Each session's point, oldest first — the order a trend is read in. Warm-ups never count. A weight
 * lift's session with no set to estimate (all past `MAX_ESTIMATE_REPS`) has no point: it is not a
 * zero. Bodyweight work is drawn by added weight when any session added some, else by reps.
 */
export function trendOf(history: ExerciseHistory): TrendPoint[] {
  const { tracking } = history
  const sessions = history.sessions
    .map((s) => ({ ...s, sets: s.sets.filter((set) => !set.isWarmup) }))
    .filter((s) => s.sets.length > 0)
  const loaded = sessions.some((s) => s.sets.some((set) => (set.weightG ?? 0) > 0))

  return sessions
    .flatMap((s): TrendPoint[] => {
      const top = topSet(s.sets, tracking)
      if (top === undefined) return []
      const at = { sessionId: s.sessionId, performedAt: s.performedAt, top }
      if (tracking === 'weight_reps') {
        const estimates = s.sets.flatMap((set) => estimatedMax(set, tracking) ?? [])
        return estimates.length === 0
          ? []
          : [{ ...at, value: Math.max(...estimates), estimated: true }]
      }
      return [{ ...at, value: MEASURE[tracking](top, loaded), estimated: false }]
    })
    .toReversed()
}

/**
 * A top set's measure, as its mode ranks it first — one per mode, or this does not compile. A weight
 * lift reaches it only where no set could be estimated, and such a session has no point.
 */
const MEASURE: { readonly [M in TrackingMode]: (top: Effort, loaded: boolean) => number } = {
  weight_reps: (top) => top.weightG ?? 0,
  bodyweight_reps: (top, loaded) => (loaded ? (top.weightG ?? 0) : (top.reps ?? 0)),
  duration: (top) => top.durationS ?? 0,
  distance_duration: (top) => top.distanceMm ?? 0,
}
