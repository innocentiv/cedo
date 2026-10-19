import type { MuscleWork, TrainingReview } from './service.ts'

/**
 * Pure: each muscle's work in two windows in, what is worth saying about it out. No database, so
 * the choice is unit-testable. The REVIEW chooses, because it knows what the comparison is for; a
 * formatter renders what it is given — it once cut the list to twelve itself, after a sort that put
 * a muscle abandoned since the period before last, and so hid exactly that muscle.
 */

/** One muscle's work in a window: working sets by load share, and weight × reps in grams. */
export interface WindowWork {
  readonly muscle: string
  readonly sets: number
  readonly lifted: number
}

/** The most-worked muscles a review names; the rest are counted, unless they declined. */
export const TOP_MUSCLES = 12

/**
 * A declined muscle had at least this many working sets before. Below it the period before was
 * incidental — a 30% share of one exercise — and its fall is noise, not a regression.
 */
export const DECLINE_FROM_SETS = 2

const oneDecimal = (n: number): number => Math.round(n * 10) / 10

export function muscleWorkOf(
  current: readonly WindowWork[],
  previous: readonly WindowWork[],
): TrainingReview['muscleWork'] {
  const now = new Map(current.map((w) => [w.muscle, w]))
  const before = new Map(previous.map((w) => [w.muscle, w.sets]))

  /**
   * The UNION of both windows, not just the current one. Iterating `current` alone made a muscle
   * trained hard last period and abandoned this one simply disappear — indistinguishable from never
   * having been trained, and precisely the regression the comparison exists to surface.
   */
  const muscles = [...new Set([...now.keys(), ...before.keys()])].map((muscle) => {
    const sets = now.get(muscle)?.sets ?? 0
    const setsBefore = before.get(muscle) ?? 0
    const work: MuscleWork = {
      muscle,
      weightedSets: oneDecimal(sets),
      liftedG: Math.round(now.get(muscle)?.lifted ?? 0),
      // On the unrounded sums.
      changePct: setsBefore === 0 ? null : Math.round(((sets - setsBefore) / setsBefore) * 100),
    }
    return { work, sets, lost: setsBefore - sets, declined: isDecline(sets, setsBefore) }
  })

  const top = muscles
    .filter((m) => m.sets > 0)
    .toSorted(
      (a, b) =>
        b.sets - a.sets ||
        b.work.liftedG - a.work.liftedG ||
        a.work.muscle.localeCompare(b.work.muscle),
    )
    .slice(0, TOP_MUSCLES)
  const named = new Set(top)
  // A top muscle that declined stays in `top`, where its change already says so.
  const declined = muscles
    .filter((m) => m.declined && !named.has(m))
    .toSorted((a, b) => b.lost - a.lost || a.work.muscle.localeCompare(b.work.muscle))

  return {
    top: top.map((m) => m.work),
    declined: declined.map((m) => m.work),
    omitted: muscles.length - top.length - declined.length,
  }
}

/** Half or less of what it got before, having got at least `DECLINE_FROM_SETS`. */
const isDecline = (sets: number, setsBefore: number): boolean =>
  setsBefore >= DECLINE_FROM_SETS && sets <= setsBefore / 2
