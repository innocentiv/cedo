import type { Progression } from './progression.ts'

/** What a rule needs to see of a prescribed set. */
interface RuledSet {
  readonly targetReps: number | null
  readonly targetWeightG: number | null
  readonly targetDurationS: number | null
  readonly targetDistanceMm: number | null
  readonly isWarmup: boolean
}

type SharedField = Exclude<keyof RuledSet, 'isWarmup'>

/**
 * What each rule moves or judges, and so what every working set must share under it (ADR-0026): one
 * target moves for all of them. Reps in reserve is never here — effort may ramp across sets, and
 * each is judged against its own. Typed over every kind, so a new rule cannot forget to say.
 */
const SHARED: Record<
  Progression['kind'],
  { readonly name: string; readonly fields: readonly SharedField[]; readonly words: string } | null
> = {
  none: null,
  linear: { name: 'linear', fields: ['targetReps', 'targetWeightG'], words: 'reps and weight' },
  double: { name: 'double', fields: ['targetReps', 'targetWeightG'], words: 'reps and weight' },
  linear_duration: { name: 'linear duration', fields: ['targetDurationS'], words: 'time' },
  linear_distance: {
    name: 'distance',
    fields: ['targetDistanceMm', 'targetDurationS'],
    words: 'distance and time',
  },
}

/**
 * What a progression rule refuses of the working sets it moves (ADR-0026) — states nothing can mean,
 * each said with what to do instead, since an AI learns the model from them. Empty when the sets
 * fit the rule. Warm-ups are never held to a rule.
 */
export function ruleIssues(rule: Progression, sets: readonly RuledSet[]): string[] {
  const working = sets.filter((s) => !s.isWarmup)
  return [...sharedIssues(rule, working), ...rangeIssues(rule, working)]
}

/** Every working set asks the same of what the rule moves or judges. */
function sharedIssues(rule: Progression, working: readonly RuledSet[]): string[] {
  const shared = SHARED[rule.kind]
  const [first, ...rest] = working
  if (shared === null || first === undefined) return []
  const differs = rest.findIndex((s) => shared.fields.some((field) => s[field] !== first[field]))
  if (differs === -1) return []
  return [
    `Under ${shared.name}, every working set asks the same ${shared.words}: set ${String(differs + 2)} differs from set 1. For sets that differ — a top set and its back-offs — use Manual`,
  ]
}

/** A double's range runs upward, and its reps lie inside it. */
function rangeIssues(rule: Progression, working: readonly RuledSet[]): string[] {
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
