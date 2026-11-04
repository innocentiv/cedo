import { useEffect, useRef, useState } from 'react'
import { type Rest, type RestChange, type SessionRest, restPhase } from '@cedo/contract'
import { chime } from './chime.ts'
import { useUntilNextSet } from './until-next-set.ts'
import { useNow } from './use-now.ts'

/**
 * The clock of the rest after the latest set (#24, #63): where it stands — none follows the set, it
 * runs with so much left, or it is over — with the +30 s taps counted and the skip, and one tone
 * when it is seen to run out: never on opening a screen whose rest is already over, never once it
 * is skipped, never when its set is undone. The taps and the skip hold until the next set starts a
 * new rest. Which rest runs, and where it stands, are the contract's (`restOf`, `restPhase`).
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

  // The tone is for the rest seen running that ran out — the same one, by the sets it follows: an
  // undo takes the session back to an earlier rest, which is no rest run out.
  const ranOut = phase.phase === 'over' && !phase.skipped
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (running) {
      seen.current = after
      return
    }
    if (ranOut && seen.current !== null && seen.current === after) chime()
    seen.current = null
  }, [running, ranOut, after])

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
