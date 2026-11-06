import { z } from 'zod'
import { type Effort, formatEffort } from './effort.ts'
import { TrackingMode } from './exercise.ts'
import { LOAD_LIMIT_WORDS, LoadLimit } from './load.ts'
import { LoggedEffort } from './log.ts'
import { Held, Progression, SetTarget } from './progression.ts'
import { heldWords } from './progression-words.ts'
import type { WeightUnit } from './units.ts'

/**
 * A person's target on one workout entry (GLOSSARY.md, "Target"; ADR-0026), beside the prescription
 * it starts from: their latest step while what it was taken against stands as the plan does, else
 * the plan's prescription — in a weight they can load (#36). Worked out as it is read; the plan is
 * never written. One shape wherever a target is read: `GET /workouts/:id/progression` (the plan
 * editor, and `workout_progression`, the AI's entry point for "evaluate my progression and set next
 * week's numbers"), a target set by hand, and — with last time — a session's (`SessionEntryTarget`).
 */
export const EntryTarget = z.object({
  entryId: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  /** So a reader says targets in the exercise's terms — `formatEffort(target, tracking, unit)`. */
  tracking: TrackingMode,
  rule: Progression,
  /** What the plan prescribes: its first working set. */
  prescribed: SetTarget,
  /** What their next session asks. */
  target: SetTarget,
  /**
   * Whether the rule moved it off the prescription — in weights they can load, so 22.5 kg shown as
   * 22 has not moved. The logger and the editor say it beside the prescription.
   */
  changed: z.boolean(),
  /** Why it held, when something did (#45): a prescription held for effort is not a stall. */
  held: Held.nullable(),
  /**
   * Where the athlete's equipment stops its weight (#36): their heaviest — under a heavier plan, or
   * trained up to it, with nothing heavier to move to (#66) — or their lightest, over a lighter
   * plan. Null otherwise — and while what they load is unknown.
   */
  limit: LoadLimit.nullable(),
  /** How many of their finished sessions took a step on the entry. Zero: no history yet. */
  sessions: z.int().nonnegative(),
  /**
   * What each warm-up asks, in set order: its own line, its weight following the working target in
   * proportion (`warmupsFor`, ADR-0026) — worked out as it is read, never kept.
   */
  warmups: z.array(SetTarget),
  /**
   * What each working set asks, in set order: under a rule, the target with that set's own reps in
   * reserve (ADR-0026); on Manual, the set's own numbers — a top set and its back-offs as written.
   * Each in a weight the athlete can load (#36).
   */
  working: z.array(SetTarget),
})
export type EntryTarget = z.output<typeof EntryTarget>

/**
 * What one entry of a session asks — `GET /sessions/:id/targets`, what the logger is pre-filled
 * with: the person's target as the steps of the sessions BEFORE this one left it, and what was done
 * last time. A session takes its step only once it is finished, so its own sets never move what it
 * asks mid-session.
 */
export const SessionEntryTarget = EntryTarget.extend({
  /**
   * The working sets of the latest earlier session that logged this exercise — in this plan or any
   * other, or none — in the order they were logged. Null when there is none.
   */
  last: z.array(LoggedEffort).nullable(),
})
export type SessionEntryTarget = z.output<typeof SessionEntryTarget>

/**
 * What the logger says beside an entry's target (docs/08-frontend.md, the workout screen): moved by
 * the rule, beside what the plan says — "Progressed to 11 × 20 kg · the plan says 10 × 20 kg" — or as
 * prescribed; then why the latest session held it, per set, in the words `workout_progression` says
 * ("held: set 3 did 7 of 10", "held for effort: set 3 left 0 in reserve, asked 2"), so what the last
 * session did is read where the next one is done. Where the athlete's equipment stopped it (#36) is
 * said after the target. No reps in reserve: each set asks its own, and the logger says it above it.
 */
export function targetLine(
  asked: EntryTarget,
  unit: WeightUnit,
  /**
   * The set it is said for: on Manual each working set asks its own. A warm-up is never judged, so
   * on one — or none given — the line says the entry's target.
   */
  set?: { readonly isWarmup: boolean; readonly target: Effort },
): string {
  const { tracking } = asked
  const said = set === undefined || set.isWarmup ? asked.target : set.target
  const limit = asked.limit === null ? '' : ` · ${LOAD_LIMIT_WORDS[asked.limit]}`
  const target = `${formatEffort(asked.target, tracking, unit)}${limit}`
  const moved = asked.changed
    ? `Progressed to ${target} · the plan says ${formatEffort(asked.prescribed, tracking, unit)}`
    : `Prescribed ${formatEffort(said, tracking, unit)}${limit}`
  return asked.held === null ? moved : `${moved} · ${heldWords(asked.held, tracking, unit)}`
}
