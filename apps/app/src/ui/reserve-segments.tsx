import { RESERVE_CHOICES, formatReserve } from '@cedo/contract'
import { Segmented } from './choice.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

const OPTIONS = RESERVE_CHOICES.map((reserve) => ({
  value: String(reserve),
  label: formatReserve(reserve),
}))

/**
 * Reps in reserve (`rpe.ts`): none to five, whole, one `Segmented`, so it never wraps under the
 * thumb. Tapping the chosen one again takes the answer back: not said needs no segment of its own.
 * Holds reps in reserve as the wire carries them: nothing in the app converts (ADR-0027).
 */
export function ReserveSegments({
  label,
  reserve,
  onChange,
  disabled,
  testID,
}: {
  /** Its field's label, or none where a line already says what it is — a set's own row. */
  readonly label?: string | undefined
  readonly reserve: number | null
  readonly onChange: (reserve: number | null) => void
  readonly disabled?: boolean | undefined
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack gap="xs">
      {label === undefined ? null : (
        <Text variant="label" tone="muted">
          {label}
        </Text>
      )}
      <Segmented
        options={OPTIONS}
        value={reserve === null ? null : String(reserve)}
        onChange={(value) => {
          onChange(Number(value))
        }}
        onClear={() => {
          onChange(null)
        }}
        numeric
        disabled={disabled}
        spoken={(option) => `${option.label} in reserve`}
        testID={testID}
      />
    </Stack>
  )
}
