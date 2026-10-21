import { RESERVE_CHOICES, formatReserve, reserveOf, rpeOf } from '@cedo/contract'
import { Chips } from './chips.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/** Not said: no chip of its own is selected. */
const NOT_SAID = 'none'

const OPTIONS = [
  { value: NOT_SAID, label: '—' },
  ...RESERVE_CHOICES.map((reserve) => ({ value: String(reserve), label: formatReserve(reserve) })),
]

/**
 * Reps in reserve — the question RPE is asked as (`rpe.ts`): none to five, in halves, or not said. Holds an RPE, so the screen never converts: the contract does.
 */
export function ReserveChips({
  label,
  hint,
  rpe,
  onChange,
  testID,
}: {
  readonly label: string
  /** One line on how to answer, under the label. */
  readonly hint?: string
  readonly rpe: number | null
  readonly onChange: (rpe: number | null) => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {hint === undefined ? null : (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      )}
      <Chips
        options={OPTIONS}
        value={rpe === null ? NOT_SAID : String(reserveOf(rpe))}
        onChange={(value) => {
          onChange(value === NOT_SAID ? null : rpeOf(Number(value)))
        }}
        testID={testID}
      />
    </Stack>
  )
}
