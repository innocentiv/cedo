import { useState } from 'react'
import { Button } from './button.tsx'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'

/**
 * Removing something from a plan edited in place (#26): the bin, asked twice — a day or an entry is
 * saved as soon as it is gone, and its id with it, so there is no taking it back. The first tap
 * turns the bin into Remove beside Cancel; the second removes. `ConfirmButton`'s rule, as a glyph.
 */
export function RemoveButton({
  label,
  onRemove,
  testID,
}: {
  /** What is removed, said aloud: "Remove Lower A". */
  readonly label: string
  readonly onRemove: () => void
  readonly testID: string
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <IconButton
        name="remove"
        label={label}
        edge="end"
        onPress={() => {
          setAsking(true)
        }}
        testID={testID}
      />
    )
  }
  return (
    <Stack direction="row" align="center" gap="xs">
      <Button
        title="Cancel"
        variant="ghost"
        size="small"
        onPress={() => {
          setAsking(false)
        }}
        testID={`${testID}-cancel`}
      />
      <Button
        title="Remove"
        variant="danger"
        size="small"
        onPress={() => {
          setAsking(false)
          onRemove()
        }}
        testID={`${testID}-confirm`}
      />
    </Stack>
  )
}
