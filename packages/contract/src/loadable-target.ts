import { type Load, type LoadLimit, loadable, steppedOn } from './load.ts'
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
 * can load. When the rule adds weight, it is the heaviest they have that is not above what the rule
 * asks, but always one weight up at least: a 1 kg increase on 2 kg dumbbells moves 22 to 24, where
 * stepping down would hold it there for good, and double progression would climb its reps forever.
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
  const shown = asked.target
  const next = nextTarget({ ...input, target: shown })
  // Its weight held, it is where the prescription as shown stopped — 25 kg asked of dumbbells
  // topping out at 24 is shown as 24, and is still the heaviest — though its reps may have climbed.
  if (next.weightG === shown.weightG) return { shown, target: next, limit: asked.limit }
  if (load === null || next.weightG === null || shown.weightG === null) {
    return { shown, ...loadableTarget(load, next) }
  }
  const up = steppedOn(load, shown.weightG, 1)
  // Nowhere up to go: the heaviest already.
  if (up === shown.weightG) return { shown, target: { ...next, weightG: up }, limit: 'heaviest' }
  const below = loadable(load, next.weightG)
  return below.weightG >= up
    ? { shown, target: { ...next, weightG: below.weightG }, limit: below.limit }
    : { shown, target: { ...next, weightG: up }, limit: null }
}
