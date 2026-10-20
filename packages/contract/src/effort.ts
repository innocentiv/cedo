import type { TrackingMode } from './exercise.ts'
import { type WeightUnit, formatDistance, formatDuration, formatWeight } from './units.ts'

/** The measured quantities a prescribed target, a logged set or a suggestion carries. */
export interface Effort {
  readonly reps: number | null
  readonly weightG: number | null
  readonly durationS: number | null
  readonly distanceMm: number | null
}

/**
 * One line for a target, a logged set or a suggestion, in the terms its tracking mode measures:
 * `8 × 60 kg`, `10 × bodyweight`, `6 × bodyweight +20 kg`, `1:00`, `5 km in 25:00`.
 *
 * Every screen used to write `${reps ?? '—'} × ${weight ?? 'bodyweight'}` for itself, which
 * rendered a plank as "— × bodyweight" — hiding the duration that was its whole prescription — and
 * a barbell lift with no load yet as "@ bodyweight". Weights read in the reader's `unit`, which
 * every caller must pass: a kilogram default would be the one screen that forgot.
 *
 * The mode is required too, and `null` only when it is not known — an unavailable exercise, whose
 * mode is withheld with its name. Then it renders what was measured and guesses nothing: `6 × 20 kg`
 * may have been a weighted pull-up. Optional, it was the one argument a new read model could leave
 * out without a word, and four did.
 */
export function formatEffort(
  effort: Effort,
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string {
  const parts = [lift(effort, tracking, unit), travel(effort)].filter((p) => p !== null)
  return parts.length === 0 ? '—' : parts.join(' ')
}

function lift(
  { reps, weightG }: Effort,
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string | null {
  const weight = (grams: number) => formatWeight(grams, unit)
  if (reps === null) return weightG === null ? null : weight(weightG)
  if (tracking === 'bodyweight_reps') {
    return weightG === null || weightG === 0
      ? `${reps} × bodyweight`
      : `${reps} × bodyweight +${weight(weightG)}`
  }
  return weightG === null ? `${reps} reps` : `${reps} × ${weight(weightG)}`
}

function travel({ distanceMm, durationS }: Effort): string | null {
  if (distanceMm === null) return durationS === null ? null : formatDuration(durationS)
  const distance = formatDistance(distanceMm)
  return durationS === null ? distance : `${distance} in ${formatDuration(durationS)}`
}

/**
 * A session's best working set, as its tracking mode ranks efforts — what "the same top set" in a
 * stall compares, and what a progress chart would plot:
 *
 * - a lift: the heaviest weight, then the most reps at it;
 * - bodyweight: the most added weight (none is nothing added), then the most reps;
 * - a hold: the longest;
 * - a run: the farthest, then the fastest over it.
 *
 * A dimension not measured counts as least. Of equal sets, the first. Undefined for no sets.
 */
export function topSet(sets: readonly Effort[], tracking: TrackingMode): Effort | undefined {
  const rank = RANKS[tracking]
  let best: Effort | undefined
  for (const set of sets) {
    if (best === undefined || outranks(rank(set), rank(best))) best = set
  }
  return best
}

const LEAST = Number.NEGATIVE_INFINITY

/** Higher is better, compared dimension by dimension in order. */
const RANKS: Readonly<Record<TrackingMode, (effort: Effort) => readonly number[]>> = {
  weight_reps: (e) => [e.weightG ?? LEAST, e.reps ?? LEAST],
  bodyweight_reps: (e) => [e.weightG ?? 0, e.reps ?? LEAST],
  duration: (e) => [e.durationS ?? LEAST],
  // Faster is a shorter time: negated, so higher is better here too; no time at all ranks last.
  distance_duration: (e) => [e.distanceMm ?? LEAST, e.durationS === null ? LEAST : -e.durationS],
}

function outranks(a: readonly number[], b: readonly number[]): boolean {
  for (const [i, value] of a.entries()) {
    const other = b[i] ?? LEAST
    if (value !== other) return value > other
  }
  return false
}
