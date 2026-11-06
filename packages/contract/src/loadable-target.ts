import { type Load, type LoadLimit, loadable } from './load.ts'
import type { SetTarget } from './progression.ts'

/** A prescription in a weight an athlete can load, and where their equipment stopped it, if it did. */
interface LoadableTarget {
  readonly target: SetTarget
  readonly limit: LoadLimit | null
}

/**
 * A prescription as an athlete can load it (#36): its weight the heaviest their equipment loads
 * that is not above it, and where it stopped, if at an end. Unknown load, or no weight, leaves it.
 * How a step lands on such weights is `takeSteps`'s (take-steps.ts).
 */
export function loadableTarget(load: Load | null, target: SetTarget): LoadableTarget {
  if (target.weightG === null) return { target, limit: null }
  const { weightG, limit } = loadable(load, target.weightG)
  return { target: { ...target, weightG }, limit }
}
