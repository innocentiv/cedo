import {
  type Effort,
  type EntryTarget,
  type EquipmentSlug,
  type LoadFor,
  type LoadLimit,
  type LoggedEffort,
  type Progression,
  type ProgressionSuggestion,
  type SessionAttempts,
  type SetAttempt,
  type SetTarget,
  type TrackingMode,
  type WorkoutSetInput,
  nextLoadableTarget,
  prescriptionOf,
  setTargetOf,
} from '@cedo/contract'
import { groupBy } from '../../lib/keyset.ts'

/**
 * Progression's evaluation, apart from its loading: rows in, suggestions out, no database. The
 * rules' maths is `nextTarget` in the contract and tested there; what is tested HERE is the wiring
 * around it — which sets count, what the prescription is, which sessions are read and in what
 * order, and when a suggestion is a change. See docs/adr/0012-progression-rules.md.
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

/** One of the caller's logged sets. A set logged outside a plan names no entry, and is not read. */
export interface LoggedSet extends Effort {
  readonly entryId: string | null
  readonly sessionId: string
  readonly isWarmup: boolean
  /** Judged against a prescribed RPE, its ceiling (#45). */
  readonly rpe: number | null
}

/**
 * One suggestion per entry, in the order the entries arrive. `prescribed` is in set order, and
 * `logs` newest session first, already capped to the depth a rule may read — that is the loader's
 * job, and it is done in SQL, where the rows are selected.
 */
export function suggest(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  logs: readonly LoggedSet[],
  loadFor: LoadFor,
): ProgressionSuggestion[] {
  return evaluate(entries, prescribed, logs, loadFor).map((e) => e.suggestion)
}

/** Each entry's suggestion, and where the athlete's equipment stopped its weight, if it did. */
function evaluate(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  logs: readonly LoggedSet[],
  loadFor: LoadFor,
): { readonly suggestion: ProgressionSuggestion; readonly limit: LoadLimit | null }[] {
  const setsByEntry = groupBy(prescribed, (s) => s.entryId)
  const logsByEntry = groupBy(
    logs.filter((l): l is LoggedSet & { entryId: string } => l.entryId !== null),
    (l) => l.entryId,
  )
  return entries.map((entry) =>
    suggestForEntry(
      entry,
      setsByEntry.get(entry.id) ?? [],
      logsByEntry.get(entry.id) ?? [],
      loadFor,
    ),
  )
}

/**
 * What a session asks of each entry — `EntryTarget` — from the same evaluation as `suggest`, over
 * logs the loader has already limited to the sessions before it; and last time's working sets of
 * each entry's exercise, by exercise.
 */
export function targetsFrom(
  entries: readonly EntryToEvaluate[],
  prescribed: readonly PrescribedSet[],
  logs: readonly LoggedSet[],
  loadFor: LoadFor,
  lastByExercise: ReadonlyMap<string, LoggedEffort[]>,
): EntryTarget[] {
  return evaluate(entries, prescribed, logs, loadFor).map(({ suggestion: s, limit }) => ({
    entryId: s.entryId,
    prescribed: s.current,
    target: s.suggested,
    changed: s.changed,
    held: s.held,
    limit,
    last: lastByExercise.get(s.exerciseId) ?? null,
  }))
}

/**
 * Judged, and answered, in weights the athlete can load (#36): `changed` is the rule moving the
 * prescription as shown, never the snapping alone — 22.5 kg shown as 22 has not progressed.
 */
function suggestForEntry(
  entry: EntryToEvaluate,
  prescribed: readonly PrescribedSet[],
  logs: readonly LoggedSet[],
  loadFor: LoadFor,
): { readonly suggestion: ProgressionSuggestion; readonly limit: LoadLimit | null } {
  const first = prescriptionOf({ sets: prescribed })
  const current = first === undefined ? NOTHING_PRESCRIBED : setTargetOf(first)
  const sessions = toSessions(logs)

  const next = nextLoadableTarget(
    {
      rule: entry.progression,
      target: current,
      workingSets: prescribed.filter((s) => !s.isWarmup).length,
      sessions,
    },
    loadFor(entry),
  )

  const suggestion = {
    entryId: entry.id,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    tracking: entry.tracking,
    rule: entry.progression,
    current,
    suggested: next.target,
    changed: !sameTarget(next.shown, next.target),
    held: next.held,
    sessionsConsidered: sessions.length,
  }
  return { suggestion, limit: next.limit }
}

/** An entry with no working set prescribes nothing — every target null. */
const NOTHING_PRESCRIBED: SetTarget = {
  reps: null,
  weightG: null,
  rpe: null,
  durationS: null,
  distanceMm: null,
}

/** Flat log rows into per-session attempts, keeping the order the sessions arrive in. */
function toSessions(rows: readonly LoggedSet[]): SessionAttempts[] {
  const bySession = new Map<string, SetAttempt[]>()
  for (const row of rows) {
    const list = bySession.get(row.sessionId) ?? []
    list.push({
      weightG: row.weightG,
      reps: row.reps,
      durationS: row.durationS,
      distanceMm: row.distanceMm,
      rpe: row.rpe,
      isWarmup: row.isWarmup,
    })
    bySession.set(row.sessionId, list)
  }
  return [...bySession.values()]
}

const sameTarget = (a: SetTarget, b: SetTarget): boolean =>
  a.reps === b.reps &&
  a.weightG === b.weightG &&
  a.rpe === b.rpe &&
  a.durationS === b.durationS &&
  a.distanceMm === b.distanceMm
