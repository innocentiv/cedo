import { type Load, type LoadLimit, loadable } from './load.ts'
import { type ProgressionInput, type SetTarget, nextTarget } from './progression.ts'

/**
 * A prescription as an athlete can load it (#36): its weight the heaviest their equipment loads
 * that is not above it, and where it stopped, if at an end. Unknown load, or no weight, leaves it.
 */
export function loadableTarget(
  load: Load | null,
  target: SetTarget,
): { readonly target: SetTarget; readonly limit: LoadLimit | null } {
  if (target.weightG === null) return { target, limit: null }
  const { weightG, limit } = loadable(load, target.weightG)
  return { target: { ...target, weightG }, limit }
}

/**
 * The next prescription as an athlete can load it (#36): judged against the weight they were shown
 * — a 22.5 kg plan logged as 22 on 2 kg dumbbells is met, not missed — and answered in a weight they
 * can load. An increase under one step loads nothing heavier: it waits for the plan to move.
 * See docs/adr/0024-targets-follow-the-athletes-equipment.md.
 */
export function nextLoadableTarget(
  input: ProgressionInput,
  load: Load | null,
): {
  /** The prescription as shown — what a session is judged against, and what "moved" is told from. */
  readonly shown: SetTarget
  readonly target: SetTarget
  readonly limit: LoadLimit | null
} {
  const asked = loadableTarget(load, input.target)
  const next = nextTarget({ ...input, target: asked.target })
  // Its weight held, it is where the prescription as shown stopped — 25 kg asked of dumbbells
  // topping out at 24 is shown as 24, and is still the heaviest — though its reps may have climbed.
  if (next.weightG === asked.target.weightG) {
    return { shown: asked.target, target: next, limit: asked.limit }
  }
  return { shown: asked.target, ...loadableTarget(load, next) }
}
