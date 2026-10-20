import { useState } from 'react'
import { Button } from './button.tsx'
import { Stack } from './stack.tsx'

export interface ConfirmButtonProps {
  /** What it does — "Delete", "Remove", "Leave". */
  readonly title: string
  readonly onConfirm: () => void
  readonly busy?: boolean
  readonly testID: string
}

/**
 * An action that cannot be taken back, asked twice: the first tap turns it into "<title> — tap again
 * to confirm" beside Cancel, the second does it. In the app's own UI, never a browser dialog — which
 * would also block the e2e WebView. Every destructive action uses this one, so none invents its own.
 */
export function ConfirmButton({
  title,
  onConfirm,
  busy = false,
  testID,
}: ConfirmButtonProps): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <Button
        title={title}
        variant="danger"
        onPress={() => {
          setAsking(true)
        }}
        testID={testID}
      />
    )
  }
  return (
    <Stack direction="row" gap="sm">
      <Button
        title="Cancel"
        variant="secondary"
        grow
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
        onPress={onConfirm}
        testID={`${testID}-confirm`}
      />
    </Stack>
  )
}
