import { z } from 'zod'
import { type Effort, formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { WeightUnit } from './units.ts'

/**
 * RPE, as GLOSSARY.md defines it: how hard a set was, or is meant to be — 5 to 10 in half-points,
 * where 10 leaves no rep in reserve and each point below it leaves one more. The same scale for a
 * target and a log.
 *
 * Asked of a person as reps in reserve — "how many more could you have done?" — which people
 * answer more reliably than an abstract 1–10 (Zourdos et al., JSCR 2016). Half-points, because
 * estimates are off by about a rep, and better near failure (Halperin et al., Sports Med 2022);
 * below 5 the reserve is too far from failure to estimate at all.
 */
export const RPE_MIN = 5
export const RPE_MAX = 10
export const RPE_STEP = 0.5

const RPE_SCALE = 'RPE is 5 to 10, in half-points'
export const Rpe = z
  .number()
  .min(RPE_MIN, RPE_SCALE)
  .max(RPE_MAX, RPE_SCALE)
  .multipleOf(RPE_STEP, RPE_SCALE)
  .describe('RPE, 5 to 10 in half-points: 10 leaves no rep in reserve, 9 one, 8.5 one and a half')

/** The reps an RPE leaves in reserve: none at 10, one more for each point below. */
export const reserveOf = (rpe: number): number => RPE_MAX - rpe

/** The RPE of a set that left `reserve` reps in the tank. */
export const rpeOf = (reserve: number): number => RPE_MAX - reserve

/** What a person is asked to choose from: none to five reps left, in halves — the whole scale. */
export const RESERVE_CHOICES: readonly number[] = Array.from(
  { length: (RPE_MAX - RPE_MIN) / RPE_STEP + 1 },
  (_, i) => i * RPE_STEP,
)

/**
 * ` · 2 in reserve` after a set with an RPE, prescribed or logged — said as the reserve it is asked
 * as — and nothing after one without.
 */
export const inReserve = (rpe: number | null): string =>
  rpe === null ? '' : ` · ${formatReserve(reserveOf(rpe))} in reserve`

/** `5 × 60 kg · 1½ in reserve`: a set, prescribed or logged, and the reserve it asks or left. */
export const formatWithReserve = (
  set: Effort & { readonly rpe: number | null },
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string => `${formatEffort(set, tracking, unit)}${inReserve(set.rpe)}`

/** `1½`: reps in reserve as said aloud. */
export function formatReserve(reserve: number): string {
  const whole = Math.floor(reserve)
  if (reserve === whole) return String(whole)
  return whole === 0 ? '½' : `${whole}½`
}
