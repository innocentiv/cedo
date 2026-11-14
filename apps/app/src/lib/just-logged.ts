import type { RestAlert, RestChange, SessionRest } from '@cedo/contract'
import { useChangeRest } from '../api/session-queries.ts'
import type { JustLogged } from '../ui/index.ts'
import { useRestTold } from './rest-alert-device.ts'
import { useRestClock } from './rest-clock.ts'
import { useSubmit } from './use-submit.ts'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'

/**
 * What the session says of the rest, beside the view's own (#24): the rest as the server keeps it
 * (#38), the session a tap on it is told to, and what its end says.
 */
export interface RestOfSession {
  readonly kept: SessionRest | null
  readonly sessionId: string
  /** What its end says with the app closed (#39): the next set, as the logger asks it. */
  readonly said: RestAlert
}

/**
 * The set just logged, in Log's place (#63; GLOSSARY.md, "Just logged") — what the contract's
 * `justLogged` decides of the view, with what each control does: Undo takes the set back, +30 s and
 * Skip are held here and told to the server too (#38), "+ set" goes beyond its entry's
 * prescription. Null when Log stands alone.
 */
export function useJustLogged({
  rest,
  view,
  sets,
  onAnother,
}: {
  readonly rest: RestOfSession
  readonly view: Pick<WorkoutShown, 'shown' | 'rest'>
  readonly sets: WorkoutSets
  readonly onAnother?: (() => void) | undefined
}): JustLogged | null {
  const tell = useChangeRest(rest.sessionId)
  const { submit, error } = useSubmit()
  const { place, did } = useRestClock(view, sets.server, rest.kept)
  const told = useRestTold(place.phase, rest.said, rest.sessionId)
  if (place.set === null) return null
  const { stored, restLeft, ...set } = place.set
  const after = view.rest?.after
  const tapped = (change: RestChange['change']) => () => {
    if (after === undefined) return
    did({ kind: 'tapped', change, after })
    // In the session's queue, behind the sets: offline, it is sent after them.
    void submit(async () => {
      await tell.mutateAsync({ sets: after, change })
    })
  }
  return {
    rest:
      restLeft === null
        ? null
        : {
            left: restLeft,
            onExtend: tapped('extend'),
            onSkip: tapped('skip'),
            onTell: told.offer,
          },
    onUndo:
      stored === null
        ? null
        : () => {
            sets.undo(stored)
          },
    set: { ...set, onAnother },
    error: error ?? told.refused,
  }
}
