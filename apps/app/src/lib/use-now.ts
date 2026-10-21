import { useEffect, useState } from 'react'

/**
 * The time now, a second at a time, for a screen that counts something down — the rest after a
 * set. The count itself is the contract's (`restLeft`), from when the server logged the set; this
 * only moves the clock it reads.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(tick)
    }
  }, [])
  return now
}
