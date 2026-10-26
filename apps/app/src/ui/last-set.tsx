import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * The set just logged — or one re-opened from its mark (#24): what it was — its reserve with it, said
 * before it was logged (#37) — whether it was a personal best, and Undo. A set still waiting for a
 * signal is said so, with nothing to change on it until the server has it.
 */
export function LastSet({
  title,
  effort,
  best,
  waiting,
  onUndo,
  onAnother,
  testID,
}: {
  readonly title: string
  readonly effort: string
  readonly best: boolean
  readonly waiting: boolean
  readonly onUndo: (() => void) | null
  /** "+ set": another beyond the prescription, once the set's entry has all it asked for. */
  readonly onAnother?: (() => void) | undefined
  readonly testID: string
}): React.JSX.Element {
  return (
    <Card testID={testID}>
      <Stack gap="md">
        <Stack direction="row" align="center" gap="sm">
          <Stack grow gap="xs">
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {title}
            </Text>
            <Stack direction="row" align="baseline" gap="md" wrap>
              <Text variant="number" testID={`${testID}-effort`}>
                {effort}
              </Text>
              {best ? (
                <Text variant="label" tone="best" testID={`${testID}-best`}>
                  Personal best
                </Text>
              ) : null}
            </Stack>
          </Stack>
          {onAnother === undefined ? null : (
            <Button
              title="+ set"
              variant="secondary"
              size="small"
              onPress={onAnother}
              testID={`${testID}-another`}
            />
          )}
          {onUndo === null ? null : (
            <IconButton
              name="undo"
              label="Undo this set"
              edge="end"
              onPress={onUndo}
              testID={`${testID}-undo`}
            />
          )}
        </Stack>
        {waiting ? (
          <Text variant="caption" tone="muted" testID={`${testID}-waiting`}>
            Waiting for a signal — kept, and sent when it is back.
          </Text>
        ) : null}
      </Stack>
    </Card>
  )
}
