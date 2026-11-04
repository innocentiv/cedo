import {
  type LoggedExercise,
  type Rest,
  type SessionRest,
  formatWithReserve,
  loggedLabel,
} from '@cedo/contract'
import type { PendingLog } from '../api/pending.ts'
import { useChangeRest } from '../api/session-queries.ts'
import type { JustDone } from '../ui/index.ts'
import { exerciseName } from './exercise-name.ts'
import { useRestClock } from './rest-clock.ts'
import { useSubmit } from './use-submit.ts'
import type { WorkoutSets } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * The rest after the latest set (#24): as the sets say it (`restOf`) — sets waiting for a signal
 * too — and as the server keeps it (#38), with the session it is told to.
 */
export interface RestShown {
  readonly rest: Rest | null
  readonly kept: SessionRest | null
  readonly sessionId: string
  /** How many sets the session has — waiting for a signal too: what a tap names (#38). */
  readonly sets: number
}

/**
 * The set just logged, while it can still be taken back where it was logged (#63): while its rest
 * runs — +30 s and Skip told to the server too (#38) — or, with no rest after it, until the next set.
 * Null before the first set, after an undo until the next, and once the rest is over: the chime has
 * said so, and Log is back. A set
 * still waiting for a signal has no Undo yet. Its "+ set" goes beyond its entry's prescription.
 */
export function useJustDone({
  rest,
  shown,
  sets,
  onAnother,
}: {
  readonly rest: RestShown
  readonly shown: { readonly log: PendingLog; readonly exercise: LoggedExercise | null } | null
  readonly sets: WorkoutSets
  readonly onAnother?: (() => void) | undefined
}): JustDone | null {
  const unit = useWeightUnit()
  const tell = useChangeRest(rest.sessionId)
  const { submit, error } = useSubmit()
  // With nothing just logged — after an undo, until the next set — no rest runs, nor chimes (#63).
  const clock = useRestClock(shown === null ? null : rest.rest, rest.kept, rest.sets, (change) => {
    // In the session's queue, behind the sets: offline, it is sent after them.
    void submit(async () => {
      await tell.mutateAsync(change)
    })
  })
  const { phase } = clock
  if (shown === null || phase.phase === 'over') return null
  const { log, exercise } = shown
  const stored = sets.server.find((l) => l.id === log.id)
  return {
    rest:
      phase.phase === 'running'
        ? { left: phase.left, onExtend: clock.extend, onSkip: clock.skip }
        : null,
    onUndo:
      stored === undefined
        ? null
        : () => {
            sets.undo(stored)
          },
    set: {
      title: `${exerciseName(exercise)} · ${stored === undefined ? 'set' : loggedLabel(stored, sets.server)}`,
      effort: formatWithReserve(log, exercise?.tracking ?? null, unit),
      best: stored?.personalBest === true,
      waiting: sets.waiting.has(log.id),
      onAnother,
    },
    error,
  }
}
