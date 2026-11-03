import {
  type Against,
  type EntryTarget,
  type EquipmentSlug,
  type Held,
  type LoadFor,
  type LoadLimit,
  type LoggedEffort,
  type Progression,
  type ProgressionSuggestion,
  type SetTarget,
  type TrackingMode,
  type WorkoutSetInput,
  againstOf,
  loadableTarget,
  prescriptionOf,
  setTargetOf,
  stillCounts,
  warmupsFor,
} from '@cedo/contract'
import { groupBy } from '../../lib/keyset.ts'

/**
 * Progression's reading, apart from its loading: rows in, targets out, no database (ADR-0026). A
 * person's target is their latest step, while what it was taken against stands as the plan does
 * now — else the plan's prescription; either is shown in a weight they can load (#36). The rules'
 * maths runs when a step is taken (`write-steps.ts`), never here.
 */

/** An entry whose exercise the caller can see — the only kind there is anything to advise about. */
export interface EntryToEvaluate {
  readonly id: string
  readonly exerciseId: string
  readonly exerciseName: string
  readonly tracking: TrackingMode
  /** What it needs: the item holding its load says what weights the athlete can put on it (#36). */
  readonly equipment: readonly EquipmentSlug[] | null
  readonly progression: Progression
}

/** A prescribed set of one of those entries. */
export interface PrescribedSet extends WorkoutSetInput {
  readonly entryId: string
}

/** The caller's latest step on an entry, and how many finished sessions have taken one. */
export interface LatestStep {
  readonly entryId: string
  readonly target: SetTarget
  readonly held: Held | null
  readonly against: Against
  readonly sessions: number
}

/** One suggestion per entry, in the order the entries arrive. `prescribed` is in set order. */
export function suggest(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  steps: readonly LatestStep[],
  loadFor: LoadFor,
): ProgressionSuggestion[] {
  return evaluate(entries, prescribed, steps, loadFor).map((e) => e.suggestion)
}

/** Each entry's suggestion, and where the athlete's equipment stopped its weight, if it did. */
function evaluate(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  steps: readonly LatestStep[],
  loadFor: LoadFor,
): {
  readonly entry: EntryToEvaluate
  readonly suggestion: ProgressionSuggestion
  readonly limit: LoadLimit | null
}[] {
  const setsByEntry = groupBy(prescribed, (s) => s.entryId)
  const stepByEntry = new Map(steps.map((s) => [s.entryId, s]))
  return entries.map((entry) =>
    Object.assign(
      suggestForEntry(entry, setsByEntry.get(entry.id) ?? [], stepByEntry.get(entry.id), loadFor),
      { entry },
    ),
  )
}

/**
 * What a session asks of each entry — `EntryTarget` — from the same reading as `suggest`; and last
 * time's working sets of each entry's exercise, by exercise.
 */
export function targetsFrom(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  steps: readonly LatestStep[],
  loadFor: LoadFor,
  lastByExercise: ReadonlyMap<string, LoggedEffort[]>,
): EntryTarget[] {
  const warmupsByEntry = groupBy(
    prescribed.filter((s) => s.isWarmup),
    (s) => s.entryId,
  )
  return evaluate(entries, prescribed, steps, loadFor).map(({ entry, suggestion: s, limit }) => ({
    entryId: s.entryId,
    prescribed: s.current,
    target: s.suggested,
    changed: s.changed,
    held: s.held,
    limit,
    last: lastByExercise.get(s.exerciseId) ?? null,
    warmups: warmupsFor(
      (warmupsByEntry.get(s.entryId) ?? []).map((w) => setTargetOf(w)),
      s.current,
      s.suggested,
      loadFor(entry),
    ),
  }))
}

/**
 * In weights the athlete can load (#36): `changed` is the target moved off the prescription as
 * shown, never the snapping alone — 22.5 kg shown as 22 has not progressed.
 */
function suggestForEntry(
  entry: EntryToEvaluate,
  prescribed: readonly PrescribedSet[],
  latest: LatestStep | undefined,
  loadFor: LoadFor,
): { readonly suggestion: ProgressionSuggestion; readonly limit: LoadLimit | null } {
  const first = prescriptionOf({ sets: prescribed })
  const current = first === undefined ? NOTHING_PRESCRIBED : setTargetOf(first)
  const now = againstOf(
    entry.progression,
    prescribed.filter((s) => !s.isWarmup),
  )
  const counts = latest !== undefined && stillCounts(latest.against, now)
  const load = loadFor(entry)
  const shown = loadableTarget(load, current)
  // The rule never moves reps in reserve: the target asks what the plan asks of it.
  const reached = counts
    ? loadableTarget(load, { ...latest.target, reserve: current.reserve })
    : shown

  const suggestion = {
    entryId: entry.id,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    tracking: entry.tracking,
    rule: entry.progression,
    current,
    suggested: reached.target,
    changed: !sameTarget(shown.target, reached.target),
    held: counts ? latest.held : null,
    sessionsConsidered: latest?.sessions ?? 0,
  }
  return { suggestion, limit: reached.limit }
}

/** An entry with no working set prescribes nothing — every target null. */
const NOTHING_PRESCRIBED: SetTarget = {
  reps: null,
  weightG: null,
  reserve: null,
  durationS: null,
  distanceMm: null,
}

const sameTarget = (a: SetTarget, b: SetTarget): boolean =>
  a.reps === b.reps &&
  a.weightG === b.weightG &&
  a.reserve === b.reserve &&
  a.durationS === b.durationS &&
  a.distanceMm === b.distanceMm
