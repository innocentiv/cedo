import { useState } from 'react'

/**
 * A tap on the rest that holds until the next set (#24, #38): a rest extended or skipped.
 * `latest` is what marks "the next set" — how many sets the session has; once it changes, the tap
 * is gone and the band's own answer returns. What the athlete chose to look at is held otherwise, by what was done
 * (`useChoices`, workout-state.ts): a set's id changes as it lands, so it is no mark for those.
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
