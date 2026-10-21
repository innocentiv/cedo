import { useEffect, useState } from 'react'

/**
 * The time now, a second at a time while `ticking` — for a countdown, the rest after a set. The
 * count itself is the contract's (`restLeft`), from when the server logged the set; this only moves
 * the clock it reads, and stops it when nothing is counting.
 */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    // At once, not a second late: what started the count may have arrived while it stood still.
    setNow(Date.now())
    const tick = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(tick)
    }
  }, [ticking])
  return now
}
