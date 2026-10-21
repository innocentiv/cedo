import { useState } from 'react'
import { type SetLog, type WorkoutEntry, formatDuration, restLeft } from '@cedo/contract'
import { useNow } from '../lib/use-now.ts'
import { Text } from './text.tsx'

/**
 * The entry's rest after its latest working set — "Rest 1:28", then "Rest over" — as the contract
 * counts it (`restLeft`). Its own component, owning the clock, so only this line re-renders each
 * second, and only while a rest is running: the clock stops once it is over, or when there is none,
 * and starts again with the next set — which reads its full rest at once, never more (`restLeft`).
 */
export function RestCountdown({
  logs,
  entry,
  testID,
}: {
  readonly logs: readonly SetLog[]
  readonly entry: Pick<WorkoutEntry, 'id' | 'restSeconds'>
  readonly testID: string
}): React.JSX.Element | null {
  const [ticking, setTicking] = useState(true)
  const now = useNow(ticking)
  const left = restLeft(logs, entry, now)
  const running = left !== null && left > 0
  // Derived from this render, as React allows: the next render ticks, or stops.
  if (running !== ticking) setTicking(running)
  if (left === null) return null
  return (
    <Text variant="label" tone={left === 0 ? 'success' : 'accent'} testID={testID}>
      {left === 0 ? 'Rest over — ready for the next set' : `Rest ${formatDuration(left)}`}
    </Text>
  )
}
