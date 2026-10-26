import { formatEffort } from './effort.ts'
import type { RestAlert } from './push.ts'
import type { TrackingMode } from './exercise.ts'
import type { SetTarget } from './progression.ts'
import { type FlowEntry, type FlowLog, focusOf, nextSet, setsOf } from './session-flow.ts'
import { nextSetWords } from './set-marks.ts'
import type { WeightUnit } from './units.ts'

/** An entry as the alert names it: what the logger reads, and its exercise's name and measure. */
type AlertEntry = FlowEntry & {
  readonly exercise: { readonly name: string; readonly tracking: TrackingMode } | null
}

/**
 * What a rest alert says (#38): that the rest is over, and the next set as the logger would ask it —
 * "Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg" — the focus the screen would come back to, at
 * the target this session asks. Without a plan to say what is next, only that the rest is over.
 */
export function restAlertOf(
  day: { readonly entries: readonly AlertEntry[] } | null,
  logs: readonly FlowLog[],
  targets: readonly { readonly entryId: string; readonly target: SetTarget }[],
  unit: WeightUnit,
): Omit<RestAlert, 'url'> {
  const title = 'Rest over'
  const entry = day === null ? null : focusOf(day, logs)
  if (entry === null || entry.exercise === null) return { title, body: 'Time for the next set.' }
  const working = targets.find((t) => t.entryId === entry.id)?.target ?? null
  const sets = setsOf(entry, logs, working)
  const next = nextSet(sets)
  const words = nextSetWords(sets, next, true)
  const effort =
    next === null ? '' : `: ${formatEffort(next.target, entry.exercise.tracking, unit)}`
  return { title, body: `${entry.exercise.name} — ${words.title}${effort}` }
}
