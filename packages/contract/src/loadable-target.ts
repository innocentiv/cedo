import { type Load, type LoadLimit, loadable, steppedOn } from './load.ts'
import { type Held, type ProgressionInput, type SetTarget, progress } from './progression.ts'

/** A prescription in a weight an athlete can load, and where their equipment stopped it, if it did. */
interface LoadableTarget {
  readonly target: SetTarget
  readonly limit: LoadLimit | null
}

/**
 * A prescription as an athlete can load it (#36): its weight the heaviest their equipment loads
 * that is not above it, and where it stopped, if at an end. Unknown load, or no weight, leaves it.
 */
export function loadableTarget(load: Load | null, target: SetTarget): LoadableTarget {
  if (target.weightG === null) return { target, limit: null }
  const { weightG, limit } = loadable(load, target.weightG)
  return { target: { ...target, weightG }, limit }
}

/**
 * The next prescription as an athlete can load it (#36): judged against the weight they were shown
 * — a 22.5 kg plan logged as 22 on 2 kg dumbbells is met, not missed — and answered in a weight they
 * can load (`fitted`). See docs/adr/0024-targets-follow-the-athletes-equipment.md.
 */
export function nextLoadableTarget(
  input: ProgressionInput,
  load: Load | null,
): LoadableTarget & {
  /** The prescription as shown — what a session is judged against, and what "moved" is told from. */
  readonly shown: SetTarget
  /** Why the rule held, as it told it — see `progress`. */
  readonly held: Held | null
} {
  const asked = loadableTarget(load, input.target)
  const { target: next, held } = progress({ ...input, target: asked.target })
  return { shown: asked.target, ...fitted(load, asked, next), held }
}

/**
 * `next` in a weight the athlete can load, moved on from the prescription as they were shown it
 * (`asked`). When the rule adds weight, it is the heaviest they have that is not above what the rule
 * asks, but always one weight up at least: a 1 kg increase on 2 kg dumbbells moves 22 to 24, where
 * stepping down would hold it there for good, and double progression would climb its reps forever.
 */
function fitted(load: Load | null, asked: LoadableTarget, next: SetTarget): LoadableTarget {
  const shown = asked.target
  // Its weight held, it is where the prescription as shown stopped — 25 kg asked of dumbbells
  // topping out at 24 is shown as 24, and is still the heaviest — though its reps may have climbed.
  if (next.weightG === shown.weightG) return { target: next, limit: asked.limit }
  if (load === null || next.weightG === null || shown.weightG === null) {
    return loadableTarget(load, next)
  }
  const up = steppedOn(load, shown.weightG, 1)
  // Nowhere up to go: the heaviest already.
  if (up === shown.weightG) return { target: { ...next, weightG: up }, limit: 'heaviest' }
  const below = loadable(load, next.weightG)
  return below.weightG >= up
    ? { target: { ...next, weightG: below.weightG }, limit: below.limit }
    : { target: { ...next, weightG: up }, limit: null }
}
