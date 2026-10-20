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
