import { Button } from './button.tsx'
import { Card } from './card.tsx'
import { ReserveChips } from './reserve-chips.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * The set just logged — or one re-opened from its mark (#24): what it was, whether it was a
 * personal best, how hard it was, and Undo. Reserve is asked here, after the set, and only of a set
 * counted in reps (`asksReserve`); a set still waiting for a signal is said so, with nothing to
 * change on it until the server has it.
 */
export function LastSet({
  title,
  effort,
  best,
  waiting,
  reserve,
  onUndo,
  testID,
}: {
  readonly title: string
  readonly effort: string
  readonly best: boolean
  readonly waiting: boolean
  readonly reserve: {
    readonly rpe: number | null
    readonly onChange: (rpe: number | null) => void
  } | null
  readonly onUndo: (() => void) | null
  readonly testID: string
}): React.JSX.Element {
  return (
    <Card testID={testID}>
      <Stack gap="sm">
        <Stack direction="row" align="center" gap="md">
          <Stack grow gap="xs">
            <Text variant="caption" tone="muted">
              {title}
            </Text>
            <Text variant="number" testID={`${testID}-effort`}>
              {effort}
            </Text>
          </Stack>
          {onUndo === null ? null : (
            <Button title="Undo" variant="ghost" onPress={onUndo} testID={`${testID}-undo`} />
          )}
        </Stack>
        {best ? (
          <Text variant="label" tone="success" testID={`${testID}-best`}>
            Personal best
          </Text>
        ) : null}
        {waiting ? (
          <Text variant="caption" tone="warning" testID={`${testID}-waiting`}>
            Waiting for a signal — kept, and sent when it is back.
          </Text>
        ) : null}
        {reserve === null ? null : (
          <ReserveChips
            label="How many more could you have done?"
            rpe={reserve.rpe}
            onChange={reserve.onChange}
            testID={`${testID}-reserve`}
          />
        )}
      </Stack>
    </Card>
  )
}
