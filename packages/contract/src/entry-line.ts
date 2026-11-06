import { type Effort, formatEffort } from './effort.ts'
import type { TrackingMode } from './exercise.ts'
import type { Progression } from './progression.ts'
import { describeProgression } from './progression-words.ts'
import { type WeightUnit, formatWeight } from './units.ts'

/** A set as the outline reads it, from a plan as read or a draft through `setTargetOf`. */
interface LineSet {
  readonly isWarmup: boolean
  readonly target: Effort
}

const count = (n: number): string => `${n} set${n === 1 ? '' : 's'}`

/**
 * The working sets as runs of equal ones, in order — reps in reserve aside, which may ramp under
 * any rule: `3 sets · 10 × 20 kg`, or a top set and its back-offs, `1 set 6 × 90 kg · 2 sets 8 ×
 * 80 kg`. Under a rule every working set asks the same (ADR-0026), so it is one run.
 */
export function workingRuns(
  sets: readonly LineSet[],
  tracking: TrackingMode | null,
  unit: WeightUnit,
): string {
  const efforts = sets.filter((s) => !s.isWarmup).map((s) => formatEffort(s.target, tracking, unit))
  if (efforts.length === 0) return 'no working sets'
  const grouped: { effort: string; n: number }[] = []
  for (const effort of efforts) {
    const last = grouped.at(-1)
    if (last?.effort === effort) last.n += 1
    else grouped.push({ effort, n: 1 })
  }
  if (grouped.length === 1) return `${count(efforts.length)} · ${efforts[0] ?? ''}`
  return grouped.map((g) => `${count(g.n)} ${g.effort}`).join(' · ')
}

/**
 * An entry as its outline line says it (docs/08-frontend.md, "Editing a workout"): its working sets,
 * its rule in full — Manual too — and, under a rule, the viewer's own target after it, only when it
 * moved off the plan: `3 sets · 10 × 20 kg · Double 8–12, +5 kg · next 12 × 40 kg`. Whether it
 * moved is the server's `changed`, not a comparison here: its target is in a weight the equipment
 * loads (#36), the plan as written — 22.5 kg read as 22 has not progressed. A target says no reps
 * in reserve: each set asks the plan's own.
 */
export function entryLine(
  sets: readonly LineSet[],
  rule: Progression,
  tracking: TrackingMode | null,
  unit: WeightUnit,
  own: { readonly target: Effort; readonly changed: boolean } | null,
): string {
  const words = describeProgression(rule, (grams) => formatWeight(grams, unit))
  const line = `${workingRuns(sets, tracking, unit)} · ${words}`
  if (rule.kind === 'none' || own === null || !own.changed) return line
  return `${line} · next ${formatEffort(own.target, tracking, unit)}`
}
