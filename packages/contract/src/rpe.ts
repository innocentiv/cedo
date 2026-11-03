import { z } from 'zod'
import { type Effort, formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { WeightUnit } from './units.ts'

/**
 * The stored scale behind reps in reserve (ADR-0027): 5 to 10, whole, where 10 leaves no rep in
 * reserve and each point below it leaves one more. The same scale for a target and a log. Nothing a
 * person or an AI reads or writes says RPE: they are asked, and told, reps in reserve — "how many
 * more could you have done?" — which people answer more reliably than an abstract 1–10 (Zourdos et
 * al., JSCR 2016). Whole, because a half reserve means nothing to the person asked; below 5 the
 * reserve is too far from failure to estimate at all.
 */
export const RPE_MIN = 5
export const RPE_MAX = 10
export const RPE_STEP = 1

const RESERVE_SCALE =
  'Reps in reserve are whole, none to five: a range such as 1–2 is asked as its bottom'
export const Rpe = z
  .number()
  .min(RPE_MIN, RESERVE_SCALE)
  .max(RPE_MAX, RESERVE_SCALE)
  .multipleOf(RPE_STEP, RESERVE_SCALE)
  .describe('Reps in reserve, stored as 10 minus them: 10 leaves none, 9 one, 5 five — whole')

/** The reps an RPE leaves in reserve: none at 10, one more for each point below. */
export const reserveOf = (rpe: number): number => RPE_MAX - rpe

/** The RPE of a set that left `reserve` reps in the tank. */
export const rpeOf = (reserve: number): number => RPE_MAX - reserve

/**
 * What a person is asked to choose from: none to five reps left, whole — one row under the thumb
 * (#24 review), and the whole scale (ADR-0027).
 */
export const RESERVE_CHOICES: readonly number[] = Array.from(
  { length: RPE_MAX - RPE_MIN + 1 },
  (_, i) => i,
)

/**
 * ` · 2 in reserve` after a set with an RPE, prescribed or logged — said as the reserve it is asked
 * as — and nothing after one without.
 */
export const inReserve = (rpe: number | null): string =>
  rpe === null ? '' : ` · ${formatReserve(reserveOf(rpe))} in reserve`

/** `5 × 60 kg · 1 in reserve`: a set, prescribed or logged, and the reserve it asks or left. */
export const formatWithReserve = (
  set: Effort & { readonly rpe: number | null },
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string => `${formatEffort(set, tracking, unit)}${inReserve(set.rpe)}`

/** `1`: reps in reserve as said aloud — whole, so as written. */
export const formatReserve: (reserve: number) => string = String
