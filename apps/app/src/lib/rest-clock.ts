import { useEffect, useRef, useState } from 'react'
import {
  type Rest,
  type RestChange,
  type SessionRest,
  chimesAtEnd,
  restPhase,
} from '@cedo/contract'
import { chime } from './chime.ts'
import { chimesNow } from './rest-alert-device.ts'
import { useUntilNextSet } from './until-next-set.ts'
import { useNow } from './use-now.ts'

/**
 * The clock of the rest after the latest set (#24, #63): where it stands — none follows the set, it
 * runs with so much left, or it is over — with the +30 s taps counted and the skip, and one tone
 * when it is seen to run out: never on opening a screen whose rest is already over, never once it
 * is skipped, never when its set is undone. The taps and the skip hold until the next set starts a
 * new rest. Which rest runs, where it stands, and whether its end chimes are the contract's
 * (`restOf`, `restPhase`, `chimesAtEnd`); this keeps the clock, and which rest it saw running.
 */
export function useRestClock(
  rest: Rest | null,
  /** The same rest as the server keeps it (#38): a tap elsewhere, or before a reload, is in it. */
  kept: SessionRest | null,
  /**
   * How many sets the session has: the rest is the one after the last of them. What a tap names to
   * the server, and what it holds by here — not the set's time, which a set sent without a signal
   * has from the phone first, and from the server once sent (#38).
   */
  sets: number,
  /** Each tap told to the server, so every device counts the same rest (#38). */
  tell: (change: RestChange) => void,
) {
  const after = rest === null ? null : String(sets)
  const [extended, extend] = useUntilNextSet<number>(after)
  const [skipped, skip] = useUntilNextSet<true>(after)
  const extensions = extended ?? 0

  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const phase = restPhase(rest, extensions, kept, skipped !== null, now)
  const running = phase.phase === 'running'
  if (running !== ticking) setTicking(running)

  // The rest seen running, by the sets it follows: the one whose end chimes.
  const restAfter = rest === null ? null : sets
  const seen = useRef<number | null>(null)
  useEffect(() => {
    // An alarm set for it rings even with the app in front: the chime would sound beside it (#39).
    if (chimesAtEnd(seen.current, restAfter, phase) && chimesNow()) chime()
    seen.current = phase.phase === 'running' ? restAfter : null
  }, [phase, restAfter])

  return {
    phase,
    extend: () => {
      extend(extensions + 1)
      tell({ sets, change: 'extend' })
    },
    skip: () => {
      skip(true)
      tell({ sets, change: 'skip' })
    },
  }
}
