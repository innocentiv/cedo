import { Pressable, StyleSheet } from 'react-native'
import { elapsedS, formatDuration } from '@cedo/contract'
import { useNow } from '../lib/use-now.ts'
import { Icon } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { color, space } from './tokens.ts'

/**
 * A session left open, followed everywhere else in the app (#24): its day, its clock, and one tap
 * back to it — the arrow. A yellow band, act now, because it is the thing in progress: over the
 * tabs on a phone, at the foot of the sidebar on a desktop, where it bleeds to the sidebar's edges
 * as it does to the phone's.
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
        styles.bar,
        inSidebar ? styles.foot : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Stack direction="row" align="center" gap="md">
        <Stack grow>
          <Text variant="label" tone="onAccent" numberOfLines={1}>
            {title}
          </Text>
        </Stack>
        <Text variant="mono" tone="onAccent">
          {clock}
        </Text>
        <Icon name="forward" tone="onAccent" />
      </Stack>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.accent, paddingHorizontal: space.lg, paddingVertical: space.md },
  // The sidebar's own padding is `sm`: taken back, so the band meets its edges.
  foot: { marginTop: 'auto', marginHorizontal: -space.sm },
  pressed: { opacity: 0.85 },
})
