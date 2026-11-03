import { useState } from 'react'
import {
  formatReserve,
  prescribe,
  prescribeAt,
  reservesVary,
  sameReserveForAll,
} from '@cedo/contract'
import type { EntryDraft } from '../lib/plan-draft.ts'
import { Button } from './button.tsx'
import { Help, Label } from './entry-section.tsx'
import { ReserveSegments } from './reserve-segments.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * Reps in reserve under a rule (docs/08-frontend.md): one row for **All sets**, and **Vary by set**
 * opening a row per working set, so reps in reserve can ramp. While the sets differ the rows stay
 * open — a difference is never hidden behind a summary: the first editor showed set 1's reserve for
 * all three, and a tap wrote it over the other two — and the way back to one row is **Same for all
 * sets**, which asks first to use set 1's for every set.
 */
export function ReserveRows({
  entry,
  onChange,
  testID,
}: {
  readonly entry: EntryDraft
  readonly onChange: (entry: EntryDraft) => void
  readonly testID: string
}): React.JSX.Element {
  const varies = reservesVary(entry)
  const [bySet, setBySet] = useState(varies)
  const [asking, setAsking] = useState(false)
  const working = entry.sets.flatMap((s, i) => (s.isWarmup ? [] : [{ set: s, at: i }]))
  const first = working[0]?.set.targetReserve ?? null

  if (!bySet && !varies) {
    return (
      <Stack gap="xs">
        <Label>Reps in reserve, all sets</Label>
        <ReserveSegments
          reserve={first}
          onChange={(targetReserve) => {
            onChange(prescribe(entry, { targetReserve }))
          }}
          testID={`${testID}-reserve`}
        />
        <Button
          title="Vary by set"
          variant="secondary"
          size="small"
          onPress={() => {
            setBySet(true)
          }}
          testID={`${testID}-reserve-vary`}
        />
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Label>Reps in reserve, by set</Label>
      {working.map(({ set, at }, n) => (
        <Stack key={at} gap="xs">
          <Text variant="caption" tone="muted">{`Set ${String(n + 1)}`}</Text>
          <ReserveSegments
            reserve={set.targetReserve}
            onChange={(targetReserve) => {
              onChange(prescribeAt(entry, at, { targetReserve }))
            }}
            testID={`${testID}-set-${String(n + 1)}-reserve`}
          />
        </Stack>
      ))}
      {asking ? (
        <Stack gap="sm">
          <Help>
            {`Use set 1’s — ${first === null ? 'none asked' : `${formatReserve(first)} in reserve`} — for every set?`}
          </Help>
          <Stack direction="row" gap="sm">
            <Button
              title="Use set 1’s"
              size="small"
              onPress={() => {
                onChange(sameReserveForAll(entry))
                setAsking(false)
                setBySet(false)
              }}
              testID={`${testID}-reserve-same-confirm`}
            />
            <Button
              title="Keep them"
              variant="secondary"
              size="small"
              onPress={() => {
                setAsking(false)
              }}
              testID={`${testID}-reserve-same-cancel`}
            />
          </Stack>
        </Stack>
      ) : (
        <Button
          title="Same for all sets"
          variant="secondary"
          size="small"
          onPress={() => {
            if (varies) setAsking(true)
            else setBySet(false)
          }}
          testID={`${testID}-reserve-same`}
        />
      )}
    </Stack>
  )
}
