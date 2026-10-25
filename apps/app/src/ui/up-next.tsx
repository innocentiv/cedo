import { Pressable, StyleSheet, View } from 'react-native'
import { bySuperset } from '@cedo/contract'
import { Icon } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { ROW_HEIGHT, color, radius, space, stroke } from './tokens.ts'

export interface UpNextItem {
  readonly id: string
  readonly name: string
  /** What it asks, in one line: "3 × 8 · 80 kg". */
  readonly detail: string
  /** How far along: "1 of 3". */
  readonly progress: string
  readonly done: boolean
  readonly superset: string | null
}

/**
 * The rest of the day under the exercise in focus, one line each (#24). Entries of a superset are
 * one item, their letter beside them, because they are done as one. A tap makes an entry current;
 * a done one stays, checked and quiet, so the day reads whole.
 */
export function UpNext({
  items,
  current,
  onChoose,
  title = 'The day',
  testID,
}: {
  readonly items: readonly UpNextItem[]
  readonly current: string | null
  readonly onChoose: (id: string) => void
  /** What the list is: "The day", or the exercises added to it. */
  readonly title?: string | undefined
  readonly testID: string
}): React.JSX.Element | null {
  if (items.length === 0) return null
  const groups = bySuperset(items)
  return (
    <Stack gap="sm" testID={testID}>
      <Text variant="label" tone="muted">
        {title}
      </Text>
      {groups.map((group) => (
        <View
          key={group[0]?.id}
          style={group.length > 1 ? styles.superset : null}
          testID={group.length > 1 ? `${testID}-superset-${group[0]?.superset ?? ''}` : undefined}
        >
          {group.length > 1 ? (
            <Text variant="caption" tone="faint">
              {`Superset ${group[0]?.superset ?? ''}`}
            </Text>
          ) : null}
          {group.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              aria-selected={item.id === current}
              onPress={() => {
                onChoose(item.id)
              }}
              testID={`${testID}-${item.id}`}
              style={({ pressed }) => [
                styles.row,
                item.id === current ? styles.current : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Stack grow gap="xs">
                <Text variant="label" tone={item.done ? 'faint' : 'default'}>
                  {item.done ? `✓ ${item.name}` : item.name}
                </Text>
                <Text variant="caption" tone="faint">
                  {item.detail}
                </Text>
              </Stack>
              <Text variant="mono" tone={item.done ? 'faint' : 'muted'}>
                {item.progress}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </Stack>
  )
}

/**
 * The last line of a list: one more for it — an exercise added to the day. A line of the list it
 * adds to, quiet, not a button laid over the screen.
 */
export function AddRow({
  title,
  onPress,
  testID,
}: {
  readonly title: string
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <Icon name="plus" tone="muted" />
      <Text variant="label" tone="muted">
        {title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  /**
   * Bled into the screen's gutter: the name lines up with every other line of text on the screen,
   * and the current row's ground reaches past it.
   */
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: -space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  current: { backgroundColor: color.surface },
  pressed: { backgroundColor: color.surfaceRaised },
  superset: {
    borderLeftWidth: stroke.bold,
    borderLeftColor: color.border,
    paddingLeft: space.sm,
    gap: space.xs,
  },
})
