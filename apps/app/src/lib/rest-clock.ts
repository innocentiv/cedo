import { useEffect, useReducer, useState } from 'react'
import {
  type LogsPlace,
  NO_REST_HELD,
  type RestEvent,
  type SessionRest,
  type SetLog,
  justLogged,
  restHeldAfter,
} from '@cedo/contract'
import { chime } from './chime.ts'
import { chimesNow } from './rest-alert-device.ts'
import { useNow } from './use-now.ts'
import type { WorkoutShown } from './workout-state.ts'
import { useWeightUnit } from './weight-unit.ts'

/**
 * Log's place as the clock goes (#24, #63): the contract's `justLogged` of the view, read at the
 * time now with what this phone holds of the rest — its +30 s taps, its skip, and whether it was
 * seen running, so one tone sounds when it is seen to run out: never on opening a screen whose rest
 * is already over, never once it is skipped, never when its set is undone. Where the rest stands,
 * what is held of it and whether its end chimes are the contract's (`justLogged`, `restHeldAfter`);
 * this keeps the time, holds the value, tells it what it saw, and sounds the chime.
 */
export function useRestClock(
  view: Pick<WorkoutShown, 'shown' | 'rest'>,
  server: readonly SetLog[],
  /** The same rest as the server keeps it (#38): a tap elsewhere, or before a reload, is in it. */
  kept: SessionRest | null,
): { readonly place: LogsPlace<SetLog>; readonly did: (event: RestEvent) => void } {
  const unit = useWeightUnit()
  const [held, did] = useReducer(restHeldAfter, NO_REST_HELD)
  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const place = justLogged({ ...view, server, held, kept, unit, now })
  const running = place.phase.phase === 'running'
  if (running !== ticking) setTicking(running)

  const { chimes } = place
  const after = view.rest?.after ?? null
  useEffect(() => {
    // An alarm set for it rings even with the app in front: the chime would sound beside it (#39).
    if (chimes && chimesNow()) chime()
    did({ kind: 'seen', after, running })
  }, [chimes, running, after])

  return { place, did }
}
