import { useEffect, useRef, useState } from 'react'
import {
  type Rest,
  type RestChange,
  type SessionRest,
  restCounted,
  restRemaining,
} from '@cedo/contract'
import { chime } from './chime.ts'
import { useUntilNextSet } from './until-next-set.ts'
import { useNow } from './use-now.ts'

/**
 * The clock of the rest shown on the workout (#24): how much is left with the +30 s taps counted,
 * whether it was skipped, and one tone when it is seen to run out — never on opening a screen whose
 * rest is already over. The taps and the skip hold until the next set starts a new rest. Which rest
 * runs, and how much is left of it, are the contract's (`restOf`, `restRemaining`).
 */
export function useRestClock(
  rest: Rest | null,
  /** The same rest as the server keeps it (#38): a tap elsewhere, or before a reload, is in it. */
  kept: SessionRest | null,
  /** Each tap told to the server, which sends the alert when the rest is over (#38). */
  tell: (change: RestChange) => void,
) {
  const since = rest?.since ?? null
  const [extended, extend] = useUntilNextSet<number>(since)
  const [skipped, skip] = useUntilNextSet<true>(since)
  const extensions = extended ?? 0

  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const left = rest === null ? null : restRemaining(restCounted(rest, extensions, kept), 0, now)
  const running = left !== null && left > 0
  if (running !== ticking) setTicking(running)

  // The tone is for a rest seen running and then over: opened over, it is silent.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running && skipped === null) chime()
    wasRunning.current = running
  }, [running, skipped])

  return {
    /** Seconds left; null when no rest is shown — none started, or skipped. */
    left: skipped === null ? left : null,
    running,
    extend: () => {
      extend(extensions + 1)
      if (since !== null) tell({ since, change: 'extend' })
    },
    skip: () => {
      skip(true)
      if (since !== null) tell({ since, change: 'skip' })
    },
  }
}
