import { z } from 'zod'

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
const RPE_SCALE = 'RPE is 5 to 10, in half-points'
export const Rpe = z
  .number()
  .min(5, RPE_SCALE)
  .max(10, RPE_SCALE)
  .multipleOf(0.5, RPE_SCALE)
  .describe('RPE, 5 to 10 in half-points: 10 leaves no rep in reserve, 9 one, 8.5 one and a half')

/** The reps an RPE leaves in reserve: none at 10, one more for each point below. */
export const reserveOf = (rpe: number): number => 10 - rpe

/** The RPE of a set that left `reserve` reps in the tank. */
export const rpeOf = (reserve: number): number => 10 - reserve

/** What a person is asked to choose from: none to five reps left, in halves — the whole scale. */
export const RESERVE_CHOICES: readonly number[] = Array.from({ length: 11 }, (_, i) => i / 2)

/**
 * ` · 2 in reserve` after a set with an RPE, prescribed or logged — said as the reserve it is asked
 * as — and nothing after one without.
 */
export const inReserve = (rpe: number | null): string =>
  rpe === null ? '' : ` · ${formatReserve(reserveOf(rpe))} in reserve`

/** `1½`: reps in reserve as said aloud. */
export function formatReserve(reserve: number): string {
  const whole = Math.floor(reserve)
  if (reserve === whole) return String(whole)
  return whole === 0 ? '½' : `${whole}½`
}
