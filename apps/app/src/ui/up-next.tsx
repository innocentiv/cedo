import { Pressable, StyleSheet, View } from 'react-native'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { ROW_HEIGHT, color, radius, space } from './tokens.ts'

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
  testID,
}: {
  readonly items: readonly UpNextItem[]
  readonly current: string | null
  readonly onChoose: (id: string) => void
  readonly testID: string
}): React.JSX.Element | null {
  if (items.length === 0) return null
  const groups = items.reduce<UpNextItem[][]>((all, item) => {
    const last = all.at(-1)
    if (item.superset !== null && last?.[0]?.superset === item.superset) last.push(item)
    else all.push([item])
    return all
  }, [])
  return (
    <Stack gap="sm" testID={testID}>
      <Text variant="label" tone="muted">
        The day
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

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  current: { backgroundColor: color.surface },
  pressed: { backgroundColor: color.surfaceRaised },
  superset: {
    borderLeftWidth: 2,
    borderLeftColor: color.border,
    paddingLeft: space.sm,
    gap: space.xs,
  },
})
