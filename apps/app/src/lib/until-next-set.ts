import { useState } from 'react'

/**
 * A choice that holds until the next set is logged (#24): an entry tapped, a set re-opened, a rest
 * extended or skipped. `latest` is what marks "the next set" — the id of the set logged last, or the
 * rest's start; once it changes, the choice is gone and the screen's own answer returns.
 */
export function useUntilNextSet<T>(latest: string | null): readonly [T | null, (value: T) => void] {
  const [held, setHeld] = useState<{ readonly value: T; readonly at: string | null }>()
  return [
    held !== undefined && held.at === latest ? held.value : null,
    (value) => {
      setHeld({ value, at: latest })
    },
  ]
}
