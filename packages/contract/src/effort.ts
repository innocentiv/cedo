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

/**
 * Several sets of one exercise in one line, as they were done: `8, 8, 7 × 60 kg` when every set has
 * reps and only the reps differ, set by set otherwise — `8 × 60 kg, 6 × 65 kg`, `1:00, 0:45`. What
 * "last time" reads as beside a logger.
 */
export function formatSets(
  sets: readonly Effort[],
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string {
  const [first] = sets
  if (first === undefined) return '—'
  // Added to bodyweight, nothing is nothing however it was logged — 0, or not at all.
  const load = (s: Effort) => (tracking === 'bodyweight_reps' ? (s.weightG ?? 0) : s.weightG)
  const sameButReps = sets.every(
    (s) =>
      s.reps !== null &&
      load(s) === load(first) &&
      s.durationS === first.durationS &&
      s.distanceMm === first.distanceMm,
  )
  if (!sameButReps) return sets.map((s) => formatEffort(s, tracking, unit)).join(', ')
  // The first set's line, every set's count where its own would be: `8, 8, 7 × 60 kg`.
  const counts = sets.map((s) => s.reps).join(', ')
  const parts = [lift(first, tracking, unit, counts), travel(first)].filter((p) => p !== null)
  return parts.join(' ')
}

/** Reps and load. `count` stands where the reps go — several sets' counts, for `formatSets`. */
function lift(
  { reps, weightG }: Effort,
  tracking: TrackingMode | null,
  unit: WeightUnit,
  count: string | null = reps === null ? null : String(reps),
): string | null {
  const weight = (grams: number) => formatWeight(grams, unit)
  if (count === null) return weightG === null ? null : weight(weightG)
  if (tracking === 'bodyweight_reps') {
    return weightG === null || weightG === 0
      ? `${count} × bodyweight`
      : `${count} × bodyweight +${weight(weightG)}`
  }
  return weightG === null ? `${count} reps` : `${count} × ${weight(weightG)}`
}

function travel({ distanceMm, durationS }: Effort): string | null {
  if (distanceMm === null) return durationS === null ? null : formatDuration(durationS)
  const distance = formatDistance(distanceMm)
  return durationS === null ? distance : `${distance} in ${formatDuration(durationS)}`
}

/**
 * A session's best working set, as its tracking mode ranks efforts (`compareEfforts`) — what a
 * stall compares. See GLOSSARY.md, "Top set":
 *
 * - a lift: the heaviest weight, then the most reps at it;
 * - bodyweight: the most added weight (none is nothing added), then the most reps;
 * - a hold: the longest;
 * - a run: the farthest, then the fastest over it.
 *
 * A dimension not measured counts as least. Of equal sets, the first. Undefined for no sets.
 */
export function topSet<E extends Effort>(
  sets: readonly E[],
  tracking: TrackingMode,
): E | undefined {
  let best: E | undefined
  for (const set of sets) {
    if (best === undefined || compareEfforts(set, best, tracking) > 0) best = set
  }
  return best
}

/**
 * How two efforts rank in a tracking mode: positive when `a` is better, zero when the mode measures
 * them alike — a pull-up with no added weight and one with "+0 kg" are the same effort — negative
 * when worse. A dimension the mode does not measure plays no part.
 */
export function compareEfforts(a: Effort, b: Effort, tracking: TrackingMode): number {
  const rank = RANKS[tracking]
  const [ra, rb] = [rank(a), rank(b)]
  for (const [i, value] of ra.entries()) {
    const other = rb[i] ?? LEAST
    if (value !== other) return value > other ? 1 : -1
  }
  return 0
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
