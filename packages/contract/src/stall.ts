import { type Effort, compareEfforts, formatEffort, topSet } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { WeightUnit } from './units.ts'

/**
 * Stalled (GLOSSARY.md): an exercise whose latest sessions, three or more running, share one top
 * set. One rule, for every reader of it — `training_review` over each exercise, an exercise's own
 * history for the badge on its screen — so the two cannot disagree about the same sessions.
 */

/** A stall is at least this many sessions running with the same top set. */
export const AT_LEAST_SESSIONS = 3

/**
 * The most recent sessions a stall is judged over — and so the longest run it reports. Readers cap
 * their loads at it too, so the judgement does not grow with history.
 */
export const STALL_DEPTH = 10

/**
 * One exercise's stall — the run of its latest sessions sharing one top set (`topSet`), and that
 * set — or null when it has not stalled. `sessions` are its WORKING sets session by session, newest
 * first; past `STALL_DEPTH` they are not read. The top set, not every set: a rep missed on a
 * back-off set is not progress, and used to hide the stall. The set is passed through as given, so
 * a reader that carries more than its measures — its RPE — keeps it.
 */
export function stallOf<E extends Effort>(
  sessions: readonly (readonly E[])[],
  tracking: TrackingMode,
): { readonly sessions: number; readonly effort: E } | null {
  const tops = sessions.slice(0, STALL_DEPTH).map((efforts) => topSet(efforts, tracking))
  const [latest] = tops
  if (latest === undefined) return null
  // The same as the mode measures it: a pull-up with no added weight and one with "+0 kg" are.
  const run = tops.findIndex(
    (top) => top === undefined || compareEfforts(top, latest, tracking) !== 0,
  )
  const sessionsRunning = run === -1 ? tops.length : run
  return sessionsRunning >= AT_LEAST_SESSIONS ? { sessions: sessionsRunning, effort: latest } : null
}

/** `4 sessions at 5 × 60 kg`: a stall, as every reader of it says it. */
export const formatStall = (
  stall: { readonly sessions: number; readonly effort: Effort },
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string => `${stall.sessions} sessions at ${formatEffort(stall.effort, tracking, unit)}`
