import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { elapsedS, formatDuration } from '@cedo/contract'
import { useNow } from '../lib/use-now.ts'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { WIDE_CONTENT_MAX_WIDTH, color, space, stroke } from './tokens.ts'

/**
 * A session in progress has the app to itself (#24): this header stands where the tab bar did — back
 * out of it, the day, the time since it started, and its menu, on one line. Back leaves the session
 * in progress, followed everywhere by its return bar; only Finish, in the menu, ends it. The clock
 * ticks while the session is open; a finished one shows how long it took.
 */
export function SessionHeader({
  title,
  startedAt,
  endedAt,
  onBack,
  onMenu,
  testID,
}: {
  readonly title: string
  readonly startedAt: string
  readonly endedAt: string | null
  readonly onBack: () => void
  readonly onMenu: () => void
  readonly testID: string
}): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const now = useNow(endedAt === null)
  const elapsed = elapsedS(startedAt, endedAt === null ? now : Date.parse(endedAt))
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }]} testID={testID}>
      <Stack direction="row" align="center" gap="sm">
        <IconButton
          name="back"
          label="Back"
          edge="start"
          tone="default"
          onPress={onBack}
          testID={`${testID}-back`}
        />
        <Stack grow>
          <Text variant="heading" numberOfLines={1}>
            {title}
          </Text>
        </Stack>
        <Text variant="mono" tone="muted" testID={`${testID}-elapsed`}>
          {formatDuration(elapsed)}
        </Text>
        <IconButton
          name="more"
          label="Session menu"
          edge="end"
          tone="default"
          onPress={onMenu}
          testID={`${testID}-menu`}
        />
      </Stack>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.xs,
    borderBottomWidth: stroke.hairline,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
})
