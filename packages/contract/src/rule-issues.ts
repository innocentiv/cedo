import type { Progression } from './progression.ts'

/** What a rule needs to see of a prescribed set. */
interface RuledSet {
  readonly targetReps: number | null
  readonly isWarmup: boolean
}

/**
 * What a progression rule refuses of the working sets it moves (ADR-0026) — states nothing can mean,
 * each said with what to do instead, since an AI learns the model from them. Empty when the sets
 * fit the rule. Warm-ups are never held to a rule.
 */
export function ruleIssues(rule: Progression, sets: readonly RuledSet[]): string[] {
  const working = sets.filter((s) => !s.isWarmup)
  if (rule.kind !== 'double') return []
  const [from, to] = rule.repRange
  if (from > to)
    return [`A double range runs from fewer reps to more: ${to} to ${from}, not ${from} to ${to}`]
  if (from === to)
    return ['A double range runs from fewer reps to more — for one rep count, use linear']
  const outside = working.find(
    (s) => s.targetReps !== null && (s.targetReps < from || s.targetReps > to),
  )
  if (outside === undefined) return []
  return [
    `Double ${from}–${to} starts at ${from} to ${to} reps, not ${String(outside.targetReps)}: set the reps inside the range, or change it`,
  ]
}
