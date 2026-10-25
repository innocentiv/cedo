import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { elapsedS, formatDuration } from '@cedo/contract'
import { useNow } from '../lib/use-now.ts'
import { Button } from './button.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { CONTENT_MAX_WIDTH, color, space } from './tokens.ts'

/**
 * A session in progress has the app to itself (#24): this header — the day, the time since it
 * started, and its menu — stands where the tab bar did. The clock ticks while the session is open;
 * a finished one shows how long it took.
 */
export function SessionHeader({
  title,
  startedAt,
  endedAt,
  onMenu,
  testID,
}: {
  readonly title: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly onMenu: () => void
  readonly testID: string
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const now = useNow(endedAt === null)
  const elapsed = elapsedS(startedAt, endedAt === null ? now : Date.parse(endedAt))
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]} testID={testID}>
      <Stack direction="row" align="center" gap="md">
        <Stack grow>
          <Text variant="heading" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="mono" tone="muted" testID={`${testID}-elapsed`}>
            {formatDuration(elapsed)}
          </Text>
        </Stack>
        <Button title="Menu" variant="secondary" onPress={onMenu} testID={`${testID}-menu`} />
      </Stack>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
})
