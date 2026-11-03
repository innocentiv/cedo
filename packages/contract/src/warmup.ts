import type { Load } from './load.ts'
import { loadableTarget } from './loadable-target.ts'
import type { SetTarget } from './progression.ts'

/**
 * What each warm-up asks next session (ADR-0026): its own line, its weight following the working
 * target in proportion — `weight × target ÷ prescription` — in a weight the equipment loads. Worked
 * out each time it is read, never kept, so editing a warm-up takes effect at once and restarts no
 * target. Unscaled while the target is the plan's, or with no positive working weight to follow
 * (bodyweight, assisted, timed) — and on a manual entry, whose target is its plan. Both are passed
 * before snapping: 22.5 kg shown as 22 is not progress. Every warm-up is asked as it can be loaded.
 */
export function warmupsFor(
  warmups: readonly SetTarget[],
  prescription: SetTarget,
  target: SetTarget,
  load: Load | null,
): SetTarget[] {
  const planned = prescription.weightG
  const reached = target.weightG
  const scales = planned !== null && reached !== null && planned > 0 && reached !== planned
  return warmups.map((warmup) => {
    if (warmup.weightG === null) return warmup
    const weightG = scales ? Math.round((warmup.weightG * reached) / planned) : warmup.weightG
    return loadableTarget(load, { ...warmup, weightG }).target
  })
}
