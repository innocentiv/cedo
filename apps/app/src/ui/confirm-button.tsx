import { useState } from 'react'
import { Button } from './button.tsx'
import { FormError } from './feedback.tsx'
import { Stack } from './stack.tsx'

export interface ConfirmButtonProps {
  /** What it does — "Delete", "Remove", "Leave". */
  readonly title: string
  readonly onConfirm: () => Promise<void>
  readonly busy?: boolean
  /** Why the server refused it, shown where it was asked — not at the top of a long screen. */
  readonly error?: string | null
  /** Small beside other small actions, as on a note (#41); asking again is always full size. */
  readonly size?: 'small' | 'regular'
  readonly testID: string
}

/**
 * An action that cannot be taken back, asked twice: the first tap turns it into "<title> — tap again
 * to confirm" beside Cancel, the second does it. In the app's own UI, never a browser dialog — which
 * would also block the e2e WebView. Every destructive action uses this one, so none invents its own.
 *
 * Once the action settles it asks again: a refused delete left armed would send the same request on
 * the next tap, unasked.
 */
export function ConfirmButton({
  title,
  onConfirm,
  busy = false,
  error = null,
  size = 'regular',
  testID,
}: ConfirmButtonProps): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  return (
    <Stack gap="xs">
      {asking ? (
        <Stack direction="row" gap="sm">
          <Button
            title="Cancel"
            variant="secondary"
            grow
            disabled={busy}
            onPress={() => {
              setAsking(false)
            }}
            testID={`${testID}-cancel`}
          />
          <Button
            title={`${title} — tap again to confirm`}
            variant="danger"
            grow
            busy={busy}
            onPress={() => {
              void onConfirm().finally(() => {
                setAsking(false)
              })
            }}
            testID={`${testID}-confirm`}
          />
        </Stack>
      ) : (
        <Button
          title={title}
          variant="danger"
          size={size}
          onPress={() => {
            setAsking(true)
          }}
          testID={testID}
        />
      )}
      <FormError message={error} testID={`${testID}-error`} />
    </Stack>
  )
}
