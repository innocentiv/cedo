import { formatSets } from './effort.ts'
import { type SessionEntryTarget, targetLine } from './entry-target.ts'
import type { LogSetInput } from './log.ts'
import type { SetTarget } from './progression.ts'
import { type FlowEntry, type FlowLog, nextExtra, nextSet } from './session-flow.ts'
import { type MarkedSet, markedSets, nextSetWords } from './set-marks.ts'
import type { WeightUnit } from './units.ts'
import type { Undone } from './workout-choices.ts'
import type { FocusedAdded, FocusedEntry } from './workout-view.ts'

/**
 * What the logger asks (#24): of the focus `workoutView` gives — an entry of the day, or an
 * exercise added — the set it logs, its marks, the lines beside it, the key it starts again by, and
 * what the set is logged against. Pure, so the screen only draws it; see docs/08-frontend.md, "The
 * workout screen".
 */

/** The set the logger logs next: its numbers, and what it and its button are called. */
export interface NextSet {
  readonly target: SetTarget
  readonly isWarmup: boolean
  /** What it is, as the athlete reads it: "Warm-up 1 of 2", "Set 3 of 5", "Another set". */
  readonly title: string
  /** The button's words: "Log warm-up", "Log set 3", "Log another set". */
  readonly action: string
}

/** Everything the logger draws of the focus, decided. */
export interface LoggerAsks {
  /**
   * The logger is keyed by it: its numbers, and a reserve answered, start again from what the next
   * set asks when it changes. By the focus and where the set it logs stands in it — never an id: a
   * set logged without a signal changes id when the server has it, and a reserve already chosen for
   * the next set was lost to it (#37); nor by how many sets the session holds, which a set logged
   * elsewhere — another device, the AI — changes under what is typed.
   */
  readonly key: string
  readonly next: NextSet
  readonly marks: readonly MarkedSet[]
  /** When progression moved or held an entry's target, what it says beside the plan's. */
  readonly progressed: string | null
  /** Last time's working sets, as read. */
  readonly last: string | null
  /** What the set is logged against: an entry, or — none — the exercise added. */
  readonly logsAgainst: Pick<LogSetInput, 'exerciseId' | 'entryId'>
  /** The set just undone of it, which the numbers start from (#63) — or null. */
  readonly from: Undone | null
}

/**
 * What the logger asks of the focus: the next set — or, once an entry has every set it asked for,
 * "Another set" — said as the plan counts it, its sets marked (`waiting`, those not yet sent), and
 * of an entry, what its target is and was last time, in the athlete's unit.
 */
export function loggerAsks<
  E extends FlowEntry & { readonly exerciseId: string },
  X extends { readonly id: string },
  L extends FlowLog & { readonly exerciseId: string },
  T extends SessionEntryTarget,
>(
  focus: FocusedEntry<E, L, T> | FocusedAdded<X, L>,
  waiting: ReadonlySet<string>,
  unit: WeightUnit,
): LoggerAsks {
  const next = nextSet(focus.sets)
  // The set it logs: the next — or, every set an entry prescribes logged, an extra ("Another set").
  const toLog = next ?? nextExtra(focus.sets)
  const shared = {
    next: {
      target: toLog.target,
      isWarmup: toLog.isWarmup,
      ...nextSetWords(focus.sets, next, focus.kind === 'entry'),
    },
    marks: markedSets(focus.sets, waiting),
    from: focus.undone,
  }
  if (focus.kind === 'added') {
    const { exercise } = focus
    return {
      ...shared,
      key: `added:${exercise.id}:${toLog.key}`,
      progressed: null,
      last: null,
      logsAgainst: { exerciseId: exercise.id, entryId: null },
    }
  }
  const { entry, asked } = focus
  return {
    ...shared,
    key: `entry:${entry.id}:${toLog.key}`,
    progressed: asked === undefined ? null : targetLine(asked, unit, toLog),
    last: asked?.last == null ? null : `Last time ${formatSets(asked.last, asked.tracking, unit)}`,
    logsAgainst: { exerciseId: entry.exerciseId, entryId: entry.id },
  }
}
