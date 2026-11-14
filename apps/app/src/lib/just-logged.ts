import { type RestAlert, type RestChange, type SessionRest, justLogged } from '@cedo/contract'
import { useChangeRest } from '../api/session-queries.ts'
import type { JustLogged } from '../ui/index.ts'
import { useRestTold } from './rest-alert-device.ts'
import { useRestClock } from './rest-clock.ts'
import { useSubmit } from './use-submit.ts'
import type { WorkoutSets, WorkoutShown } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * What the screen knows of the rest beside the view (#24): as the server keeps it (#38), the
 * session a tap on it is told to, and what its end says.
 */
export interface RestShown {
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
  readonly rest: RestShown
  readonly view: Pick<WorkoutShown, 'shown' | 'rest'>
  readonly sets: WorkoutSets
  readonly onAnother?: (() => void) | undefined
}): JustLogged | null {
  const unit = useWeightUnit()
  const tell = useChangeRest(rest.sessionId)
  const { submit, error } = useSubmit()
  const after = view.rest?.after ?? null
  const { place, did } = useRestClock(after, (held, now) =>
    justLogged({ ...view, server: sets.server, held, kept: rest.kept, unit, now }),
  )
  const told = useRestTold(place.phase, rest.said, rest.sessionId)
  const just = place.justLogged
  if (just === null) return null
  const { stored, restLeft, ...set } = just
  const tapped = (kind: 'extended' | 'skipped', change: RestChange['change']) => () => {
    if (after === null) return
    did({ kind, after })
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
            onExtend: tapped('extended', 'extend'),
            onSkip: tapped('skipped', 'skip'),
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
