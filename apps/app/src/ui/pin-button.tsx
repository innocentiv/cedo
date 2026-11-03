import { IconButton } from './icon.tsx'

export interface PinButtonProps {
  readonly pinned: boolean
  readonly onToggle: () => void
  readonly busy?: boolean
  readonly edge?: 'start' | 'end' | undefined
  readonly testID: string
}

/**
 * Pins what you can see, or unpins it — for the "Pinned" filter of the list it is in. A star, small
 * beside which group it is in: rarely used, so it takes no line of its own. Filled in the accent
 * while pinned, said aloud as what a tap does. Inert while the last tap is in flight, so a double tap
 * does not pin and unpin. Its refusal is shown by the line it sits in.
 */
export function PinButton({
  pinned,
  onToggle,
  busy = false,
  edge,
  testID,
}: PinButtonProps): React.JSX.Element {
  return (
    <IconButton
      name={pinned ? 'starred' : 'star'}
      label={pinned ? 'Unpin' : 'Pin'}
      tone={pinned ? 'accent' : 'muted'}
      disabled={busy}
      edge={edge}
      onPress={onToggle}
      testID={testID}
    />
  )
}
