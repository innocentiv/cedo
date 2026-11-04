import { IconButton } from './icon.tsx'
import { InlineProse } from './prose.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * What the session is on, as its logger heads it (#24): the exercise's name, how to do it, and the
 * plan's cue under them — drawn as written, bold and links included (#51).
 */
export function FocusHeading({
  name,
  cue,
  onHowTo,
  testID,
}: {
  readonly name: string
  readonly cue: string | null
  /** How to do it — absent where there is nothing more to show than its name. */
  readonly onHowTo?: (() => void) | undefined
  readonly testID: string
}): React.JSX.Element {
  return (
    <Stack gap="sm">
      <Stack direction="row" align="center" gap="sm">
        <Stack grow>
          <Text variant="title" testID={`${testID}-name`}>
            {name}
          </Text>
        </Stack>
        {onHowTo === undefined ? null : (
          <IconButton
            name="info"
            label="How to do it"
            edge="end"
            onPress={onHowTo}
            testID={`${testID}-how-to`}
          />
        )}
      </Stack>
      {cue === null ? null : <InlineProse text={cue} tone="muted" testID={`${testID}-cue`} />}
    </Stack>
  )
}
