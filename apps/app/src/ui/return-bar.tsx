import { Pressable, StyleSheet, View } from 'react-native'
import { elapsedS, formatDuration } from '@cedo/contract'
import { useNow } from '../lib/use-now.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, radius, space, stroke } from './tokens.ts'

/**
 * A session left open, followed everywhere else in the app (#24): its day and its clock, and one
 * tap back to it. On a phone, a yellow bar over the tabs — act now — because it is the thing in
 * progress. In a desktop's sidebar, a line among the tabs with a yellow mark (#24 review): a column
 * of yellow beside the page shouted over a desk, where the session is one thing among several.
 */
export function ReturnBar({
  title,
  startedAt,
  onPress,
  inSidebar = false,
  testID,
}: {
  readonly title: string
  readonly startedAt: string
  readonly onPress: () => void
  readonly inSidebar?: boolean
  readonly testID: string
}): React.JSX.Element {
  const now = useNow(true)
  const clock = formatDuration(elapsedS(startedAt, now))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${title}, ${clock}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        inSidebar ? styles.line : styles.bar,
        pressed ? styles.pressed : null,
      ]}
    >
      {inSidebar ? (
        <Stack direction="row" align="center" gap="sm">
          <View style={styles.mark} />
          <Stack grow>
            <Text variant="label" numberOfLines={1}>
              {title}
            </Text>
            <Text variant="mono" tone="muted">
              {clock}
            </Text>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" align="center" gap="md">
          <Stack grow>
            <Text variant="label" tone="onAccent" numberOfLines={1}>
              {title}
            </Text>
          </Stack>
          <Text variant="mono" tone="onAccent">
            {clock}
          </Text>
          <Text variant="label" tone="onAccent">
            Back to it
          </Text>
        </Stack>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.accent, paddingHorizontal: space.lg, paddingVertical: space.md },
  line: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: stroke.hairline,
    borderColor: color.border,
  },
  mark: {
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.accent,
  },
  pressed: { opacity: 0.85 },
})
