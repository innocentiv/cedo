import {
  type Against,
  type EntryTarget,
  type EquipmentSlug,
  type Held,
  type LoadFor,
  type LoggedEffort,
  type Progression,
  type SessionEntryTarget,
  type SetTarget,
  type TrackingMode,
  type WorkoutSetInput,
  againstOf,
  loadableTarget,
  prescriptionIn,
  setTargetOf,
  standingTarget,
  warmupsFor,
} from '@cedo/contract'
import { groupBy } from '../../lib/keyset.ts'

/**
 * Progression's reading, apart from its loading: rows in, targets out, no database (ADR-0026). A
 * person's target is their latest step, while what it was taken against stands as the plan does
 * now — else the plan's prescription (`standingTarget`); either is shown in a weight they can load
 * (#36). The rules' maths runs when a step is taken (`write-steps.ts`), never here.
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

/** The caller's latest step on an entry, and the run behind it — see `EntryTarget.sessions`. */
export interface LatestStep {
  readonly entryId: string
  readonly target: SetTarget
  readonly held: Held | null
  readonly against: Against
  readonly sessions: number
  readonly byHand: boolean
}

/** Each entry's target, in the order the entries arrive. `prescribed` is in set order. */
export function targetsOf(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  steps: readonly LatestStep[],
  loadFor: LoadFor,
): EntryTarget[] {
  const setsByEntry = groupBy(prescribed, (s) => s.entryId)
  const stepByEntry = new Map(steps.map((s) => [s.entryId, s]))
  return entries.map((entry) =>
    targetOf(entry, setsByEntry.get(entry.id) ?? [], stepByEntry.get(entry.id), loadFor),
  )
}

/** What a session asks of each entry — its target — and last time's working sets of its exercise. */
export function sessionTargetsOf(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  steps: readonly LatestStep[],
  loadFor: LoadFor,
  lastByExercise: ReadonlyMap<string, LoggedEffort[]>,
): SessionEntryTarget[] {
  return targetsOf(entries, prescribed, steps, loadFor).map((target) =>
    Object.assign(target, { last: lastByExercise.get(target.exerciseId) ?? null }),
  )
}

/**
 * In weights the athlete can load (#36): `changed` is the target moved off the prescription as
 * shown, never the snapping alone — 22.5 kg shown as 22 has not progressed.
 */
function targetOf(
  entry: EntryToEvaluate,
  prescribed: readonly PrescribedSet[],
  latest: LatestStep | undefined,
  loadFor: LoadFor,
): EntryTarget {
  const working = prescribed.filter((s) => !s.isWarmup)
  const now = againstOf(entry.progression, working)
  const plan = prescriptionIn(now)
  const { target, step } = standingTarget(latest, now)
  const load = loadFor(entry)
  const shown = loadableTarget(load, plan)
  // The rule never moves reps in reserve: the target asks what the plan asks of it.
  const reached = loadableTarget(load, { ...target, reserve: plan.reserve })
  return {
    entryId: entry.id,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    tracking: entry.tracking,
    rule: entry.progression,
    prescribed: plan,
    target: reached.target,
    changed: !sameTarget(shown.target, reached.target),
    held: step?.held ?? null,
    limit: reached.limit,
    // Behind the step while it counts; a target restarted from the plan has nothing behind it.
    sessions: step?.sessions ?? 0,
    byHand: step?.byHand ?? false,
    warmups: warmupsFor(
      prescribed.filter((s) => s.isWarmup).map((w) => setTargetOf(w)),
      // Unsnapped, both: snapping a 22.5 kg plan to 22 is not progress for a warm-up to follow.
      plan,
      target,
      load,
    ),
    working: asksOf(entry, working, reached.target, load),
  }
}

/**
 * What each working set asks (ADR-0026): under a rule, the target with that set's own reps in
 * reserve; on Manual, the set's own numbers, as the athlete's equipment loads them (#36).
 */
const asksOf = (
  entry: EntryToEvaluate,
  working: readonly PrescribedSet[],
  target: SetTarget,
  load: ReturnType<LoadFor>,
): SetTarget[] =>
  working.map((s) =>
    entry.progression.kind === 'none'
      ? loadableTarget(load, setTargetOf(s)).target
      : Object.assign({}, target, { reserve: s.targetReserve }),
  )

const sameTarget = (a: SetTarget, b: SetTarget): boolean =>
  a.reps === b.reps &&
  a.weightG === b.weightG &&
  a.reserve === b.reserve &&
  a.durationS === b.durationS &&
  a.distanceMm === b.distanceMm
