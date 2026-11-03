import { againstOf, stillCounts } from './against.ts'
import type { Prescription } from './plan-editing.ts'
import type { Progression } from './progression.ts'
import { judgedBy } from './rule-issues.ts'
import type { WorkoutEntryInput } from './workout.ts'

/**
 * The entry editor's moves (docs/08-frontend.md, "An entry's settings", ADR-0026) — pure, so the
 * editor only wires them to controls, and each is tested here. What every working set shares under
 * a rule is the contract's `judgedBy`; reps in reserve is never shared, and may ramp by set.
 */

const workingOf = (entry: WorkoutEntryInput) => entry.sets.filter((s) => !s.isWarmup)

/**
 * One set changed, at its place among all the entry's sets, warm-ups first: a Manual line written
 * as on paper, a warm-up line, or one working set's reps in reserve under a rule.
 */
export const prescribeAt = <E extends WorkoutEntryInput>(
  entry: E,
  index: number,
  patch: Prescription,
): E => ({ ...entry, sets: entry.sets.map((s, i) => (i === index ? { ...s, ...patch } : s)) })

/** Whether the working sets ask different reps in reserve — a ramp, shown a row per set. */
export const reservesVary = (entry: WorkoutEntryInput): boolean =>
  new Set(workingOf(entry).map((s) => s.targetReserve)).size > 1

/** "Same for all sets": set 1's reps in reserve, asked of every working set. */
export function sameReserveForAll<E extends WorkoutEntryInput>(entry: E): E {
  const targetReserve = workingOf(entry)[0]?.targetReserve ?? null
  return { ...entry, sets: entry.sets.map((s) => (s.isWarmup ? s : { ...s, targetReserve })) }
}

/**
 * The entry under another rule: every working set takes set 1's numbers in what the rule moves or
 * judges — reps in reserve stay each set's — and a double's range takes in set 1's reps, so the
 * sets start inside it. `overwrites` says a set's numbers changed: a top set and its back-offs,
 * made one — which the editor asks before doing.
 */
export function switchRule<E extends WorkoutEntryInput>(
  entry: E,
  rule: Progression,
): { readonly entry: E; readonly overwrites: boolean } {
  const fields = judgedBy(rule.kind)
  const first = workingOf(entry)[0]
  if (first === undefined) return { entry: { ...entry, progression: rule }, overwrites: false }
  const shared = Object.fromEntries(fields.map((f) => [f, first[f]]))
  const overwrites = workingOf(entry).some((s) => fields.some((f) => s[f] !== first[f]))
  const sets = entry.sets.map((s) => (s.isWarmup ? s : { ...s, ...shared }))
  return { entry: { ...entry, progression: around(rule, first.targetReps), sets }, overwrites }
}

/** A double's range, widened to take in `reps` — never refusing what was written. */
function around(rule: Progression, reps: number | null): Progression {
  if (rule.kind !== 'double' || reps === null) return rule
  const [from, to] = rule.repRange
  return { ...rule, repRange: [Math.min(from, reps), Math.max(to, reps)] }
}

/** What "Start at" offers under double: the range's reps, so none outside it can be picked. */
export function startAtChoices(rule: Progression): readonly number[] {
  if (rule.kind !== 'double') return []
  const [from, to] = rule.repRange
  return Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => from + i)
}

/**
 * Whether an edit restarts the viewer's target from the plan (ADR-0026): what a step is compared
 * against — the rule, what it moves or judges, each set's reps in reserve — differs from before.
 * Warm-ups, the number of working sets, rest, cue and superset restart nothing.
 */
export const restartsTarget = (before: WorkoutEntryInput, after: WorkoutEntryInput): boolean =>
  !stillCounts(
    againstOf(before.progression, workingOf(before)),
    againstOf(after.progression, workingOf(after)),
  )

/**
 * A double's range edited: the working sets' reps move to its nearest end when it no longer holds
 * them, so "Start at" never shows reps outside it. A range whose `from` is not below its `to` is
 * kept as typed — the schema refuses it, and the plan's line says so (`planIssues`).
 */
export function withRange<E extends WorkoutEntryInput>(
  entry: E,
  repRange: readonly [number, number],
): E {
  const rule = entry.progression
  if (rule.kind !== 'double') return entry
  const [from, to] = repRange
  const inside = (reps: number | null) =>
    reps === null || from > to ? reps : Math.min(Math.max(reps, from), to)
  return {
    ...entry,
    progression: { ...rule, repRange: [from, to] },
    sets: entry.sets.map((s) => (s.isWarmup ? s : { ...s, targetReps: inside(s.targetReps) })),
  }
}
