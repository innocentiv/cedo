import { useEffect, useReducer, useState } from 'react'
import { type RestEvent, type RestHeld, type RestPhase, restHeldAfter } from '@cedo/contract'
import { chime } from './chime.ts'
import { chimesNow } from './rest-alert-device.ts'
import { useNow } from './use-now.ts'

/**
 * The clock the rest after the latest set is read by (#24, #63), and what this phone holds of that
 * rest: its +30 s taps, its skip, and whether it was seen running — so one tone sounds when it is
 * seen to run out, never on opening a screen whose rest is already over, never once it is skipped,
 * never when its set is undone. Where the rest stands, what is held of it and whether its end
 * chimes are the contract's (`justLogged`, `restHeldAfter`); this keeps the time, holds the value,
 * tells it what it saw, and sounds the chime.
 */
export function useRestClock<P extends { readonly phase: RestPhase; readonly chimes: boolean }>(
  /** How many sets the rest follows — or null: none runs after the set. */
  after: number | null,
  /** Log's place as the contract decides it (`justLogged`), of what is held and the time. */
  read: (held: RestHeld | null, now: number) => P,
): { readonly place: P; readonly did: (event: RestEvent) => void } {
  const [held, did] = useReducer(restHeldAfter, null)
  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const place = read(held, now)
  const running = place.phase.phase === 'running'
  if (running !== ticking) setTicking(running)

  const { chimes } = place
  useEffect(() => {
    // An alarm set for it rings even with the app in front: the chime would sound beside it (#39).
    if (chimes && chimesNow()) chime()
    did({ kind: 'seen', after, running })
  }, [chimes, running, after])

  return { place, did }
}
