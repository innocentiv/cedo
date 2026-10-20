import { Button } from './button.tsx'
import { FormError } from './feedback.tsx'
import { Stack } from './stack.tsx'

export interface PinButtonProps {
  readonly pinned: boolean
  readonly onToggle: () => void
  readonly busy?: boolean
  readonly error?: string | null
  readonly testID: string
}

/**
 * Pins what you can see, or unpins it — for the "Pinned" filter of the list it is in. Busy while the
 * last tap is in flight, so a double tap does not pin and unpin.
 */
export function PinButton({
  pinned,
  onToggle,
  busy = false,
  error = null,
  testID,
}: PinButtonProps): React.JSX.Element {
  return (
    <Stack gap="xs">
      <Button
        title={pinned ? 'Pinned ★' : 'Pin'}
        variant="secondary"
        busy={busy}
        onPress={onToggle}
        testID={testID}
      />
      <FormError message={error} testID={`${testID}-error`} />
    </Stack>
  )
}
