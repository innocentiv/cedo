import { useState } from 'react'
import {
  type ProgressionSuggestion,
  type WorkoutEntryInput,
  formatEffort,
  hasTarget,
  restartsTarget,
} from '@cedo/contract'
import { useSetTarget, useTargets } from '../api/target-queries.ts'
import type { ChangeTarget, EntryTargetView } from '../ui/index.ts'
import { useSubmit } from './use-submit.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * The viewer's own target on the entry open in the editor (ADR-0026): what their next session asks,
 * **Change** wired to the server, and — while an edit changes what the target was taken against —
 * where it was, said as "your next session restarts from the plan (you were at …)". Information,
 * not a question: the reset is derived, not written, so putting the edit back brings it back.
 *
 * The entry is remembered as it was opened, and the target as first read while it differed from
 * the plan: a save refreshes the target to the plan's at once, and the line would go with it.
 */
export function useEntryTarget(
  workoutId: string,
  entry: WorkoutEntryInput,
  suggestion: ProgressionSuggestion | undefined,
): {
  readonly target: EntryTargetView | null
  readonly change: ChangeTarget | null
  readonly restartedFrom: string | null
} {
  const unit = useWeightUnit()
  const setTarget = useSetTarget(workoutId)
  const { busy, error, submit } = useSubmit()
  const [opened] = useState(entry)
  const [wasAt, setWasAt] = useState<string | null>(null)
  if (wasAt === null && suggestion?.changed === true) {
    setWasAt(formatEffort(suggestion.suggested, suggestion.tracking, unit))
  }
  const { id } = entry
  const saved = id !== undefined && suggestion !== undefined
  return {
    target: saved ? { suggested: suggestion.suggested, warmups: suggestion.warmups } : null,
    change:
      !saved || !hasTarget(entry.progression)
        ? null
        : {
            busy,
            error,
            set: (input, done) => {
              void submit(async () => {
                await setTarget.mutateAsync({ entryId: id, target: input })
                done()
              })
            },
          },
    restartedFrom: wasAt !== null && restartsTarget(opened, entry) ? wasAt : null,
  }
}

/**
 * The viewer's own targets on a plan, by entry id — the outline's `· next` and the editor's Your
 * next session read the same answer. Empty while it is being read.
 */
export function useTargetsById(workoutId: string): ReadonlyMap<string, ProgressionSuggestion> {
  const { data } = useTargets(workoutId)
  return new Map((data ?? []).map((t) => [t.entryId, t]))
}
