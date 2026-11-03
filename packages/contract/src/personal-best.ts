import { type Effort, compareEfforts } from './effort.ts'
import { estimatedMax } from './estimate.ts'
import type { TrackingMode } from './exercise.ts'

/**
 * Personal bests (GLOSSARY.md): a working set better than every earlier working set of its
 * exercise, of which there was at least one — a first time is not a best, there being nothing to
 * beat.
 *
 * A weight lift is judged by its estimated max from what was LIFTED, the reserve left out, as
 * falling is (review/deload.ts): counted, a rating half a point harder would make a best of the same
 * set. A set beyond the estimate's range has no estimate, and neither makes nor blocks a best.
 * Every other mode is judged as its top set is (`compareEfforts`): a bodyweight movement by weight
 * added, then reps; a hold by time; distance over time by distance, then by pace at that distance.
 */

const liftedMax = (effort: Effort, tracking: TrackingMode): number | null =>
  estimatedMax({ weightG: effort.weightG, reps: effort.reps, reserve: null }, tracking)

/** Whether `effort` is strictly better than `than`. */
export function beats(effort: Effort, than: Effort, tracking: TrackingMode): boolean {
  if (tracking !== 'weight_reps') return compareEfforts(effort, than, tracking) > 0
  const mine = liftedMax(effort, tracking)
  if (mine === null) return false
  const theirs = liftedMax(than, tracking)
  return theirs === null || mine > theirs
}

/** Whether `effort` is a personal best over the `earlier` working sets of its exercise. */
export const isPersonalBest = (
  effort: Effort,
  earlier: readonly Effort[],
  tracking: TrackingMode,
): boolean => earlier.length > 0 && earlier.every((e) => beats(effort, e, tracking))

export interface LoggedWork extends Effort {
  readonly id: string
  readonly exerciseId: string
  readonly isWarmup: boolean
}

/**
 * The sets of a session that were personal bests as they were logged — each against the earlier
 * sessions' working sets of its exercise AND the working sets logged before it in this one. `logs`
 * in the order performed; `trackingOf` null for an exercise the reader cannot see, which is never
 * judged.
 */
export function personalBestsIn(
  logs: readonly LoggedWork[],
  earlier: ReadonlyMap<string, readonly Effort[]>,
  trackingOf: (exerciseId: string) => TrackingMode | null,
): Set<string> {
  const seen = new Map<string, Effort[]>()
  const bests = new Set<string>()
  for (const log of logs) {
    const tracking = trackingOf(log.exerciseId)
    if (log.isWarmup || tracking === null) continue
    const before = [...(earlier.get(log.exerciseId) ?? []), ...(seen.get(log.exerciseId) ?? [])]
    if (isPersonalBest(log, before, tracking)) bests.add(log.id)
    seen.set(log.exerciseId, [...(seen.get(log.exerciseId) ?? []), log])
  }
  return bests
}
