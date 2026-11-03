import { z } from 'zod'
import { type Effort, formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { WeightUnit } from './units.ts'

/**
 * Reps in reserve (ADR-0027): how many more reps a set could have had, or the fewest a working set is
 * meant to leave — none to five, whole. The one rating of how hard a set was, for a person and an AI
 * alike: "how many more could you have done?" is answered more reliably than an abstract 1–10
 * (Zourdos et al., JSCR 2016). Whole, because a half reserve means nothing to the person asked;
 * past five the reserve is too far from failure to estimate at all.
 */
export const RESERVE_MIN = 0
export const RESERVE_MAX = 5

const RESERVE_SCALE =
  'Reps in reserve are whole, none to five: a range such as 1–2 is asked as its bottom'
export const Reserve = z
  .number()
  .int(RESERVE_SCALE)
  .min(RESERVE_MIN, RESERVE_SCALE)
  .max(RESERVE_MAX, RESERVE_SCALE)
  .describe(
    'Reps in reserve, whole, none to five: how many more reps the set could have had. Prescribed, the fewest it must leave',
  )

/**
 * The RPE scale reps in reserve are STORED as — the one place it survives (ADR-0027): 5 to 10, ten
 * minus the reserve. Only the database column converts (`db/tables/rpe.ts`); nothing past it holds an
 * RPE.
 */
export const RPE_MIN = 5
export const RPE_MAX = 10

/** The reps an RPE leaves in reserve: none at 10, one more for each point below. */
export const reserveOf = (rpe: number): number => RPE_MAX - rpe

/** The RPE stored for a set that left `reserve` reps in the tank. */
export const rpeOf = (reserve: number): number => RPE_MAX - reserve

/** What a person is asked to choose from: none to five reps left — one row under the thumb (#24). */
export const RESERVE_CHOICES: readonly number[] = Array.from(
  { length: RESERVE_MAX - RESERVE_MIN + 1 },
  (_, i) => RESERVE_MIN + i,
)

/** ` · 2 in reserve` after a set with a reserve, prescribed or logged, and nothing after one without. */
export const inReserve = (reserve: number | null): string =>
  reserve === null ? '' : ` · ${formatReserve(reserve)} in reserve`

/** `5 × 60 kg · 1 in reserve`: a set, prescribed or logged, and the reserve it asks or left. */
export const formatWithReserve = (
  set: Effort & { readonly reserve: number | null },
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string => `${formatEffort(set, tracking, unit)}${inReserve(set.reserve)}`

/** `1`: reps in reserve as said aloud — whole, so as written. */
export const formatReserve: (reserve: number) => string = String
