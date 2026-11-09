import { formatEffort } from './effort.ts'
import type { SessionEntryTarget } from './entry-target.ts'
import type { TrackingMode } from './exercise.ts'
import { loggerAsks } from './focus-logger.ts'
import type { FlowEntry, FlowLog } from './session-flow.ts'
import type { WeightUnit } from './units.ts'
import type { Focused } from './workout-view.ts'

/** What a rest's end says with the app closed (#39), whether a notification or an alarm says it. */
export interface RestAlert {
  readonly title: string
  readonly body: string
}

type Named = { readonly name: string; readonly tracking: TrackingMode }

/** No set waits for a signal, as far as the alert's words go: only the logger's marks read it. */
const NONE_WAITING: ReadonlySet<string> = new Set()

/**
 * That the rest is over, and the next set: "Barbell Back Squat — Set 3 of 5: 5 × 102.5 kg". It is
 * the set the logger asks of the focus `workoutView` gives — what the athlete chose, the target
 * this session asks, the load their equipment makes of it — in the logger's own words, so the
 * phone never says a set the screen does not. With nothing in focus to log, only that the rest is
 * over.
 */
export function restAlertOf<
  E extends FlowEntry & { readonly exerciseId: string; readonly exercise: Named | null },
  X extends Named & { readonly id: string },
  L extends FlowLog & { readonly exerciseId: string },
  T extends SessionEntryTarget,
>(focus: Focused<E, X, L, T>, unit: WeightUnit): RestAlert {
  const title = 'Rest over'
  if (focus.kind !== 'entry' && focus.kind !== 'added') {
    return { title, body: 'Time for the next set.' }
  }
  const { next } = loggerAsks(focus, NONE_WAITING, unit)
  const exercise = focus.kind === 'entry' ? focus.entry.exercise : focus.exercise
  const effort = formatEffort(next.target, exercise.tracking, unit)
  return { title, body: `${exercise.name} — ${next.title}: ${effort}` }
}
