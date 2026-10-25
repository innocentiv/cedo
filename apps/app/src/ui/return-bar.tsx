import { Pressable, StyleSheet } from 'react-native'
import { elapsedS, formatDuration } from '@cedo/contract'
import { useNow } from '../lib/use-now.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, space } from './tokens.ts'

/**
 * A session left open, followed everywhere else in the app (#24): its day and its clock, and one
 * tap back to it. Yellow — act now — because it is the thing in progress.
 */
export function ReturnBar({
  title,
  startedAt,
  onPress,
  testID,
}: {
  readonly title: string
  readonly startedAt: string
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  const now = useNow(true)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.bar, pressed ? styles.pressed : null]}
    >
      <Stack direction="row" align="center" gap="md">
        <Stack grow>
          <Text variant="label" tone="onAccent">
            {title}
          </Text>
        </Stack>
        <Text variant="mono" tone="onAccent">
          {formatDuration(elapsedS(startedAt, now))}
        </Text>
        <Text variant="label" tone="onAccent">
          Back to it
        </Text>
      </Stack>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.accent, paddingHorizontal: space.lg, paddingVertical: space.md },
  pressed: { opacity: 0.85 },
})
