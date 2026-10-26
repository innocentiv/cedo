import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONTENT_MAX_WIDTH, WIDE_CONTENT_MAX_WIDTH, color, space } from './tokens.ts'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface ScreenProps {
  readonly title?: string | undefined
  readonly children: React.ReactNode
  /** Pinned to the bottom, outside the scroll area — where a primary action belongs. */
  readonly footer?: React.ReactNode | undefined
  /** Pinned to the top, outside the scroll area, in place of the title — a session's own header. */
  readonly header?: React.ReactNode | undefined
  /**
   * A way back beside the title, for a screen reached from another with no other way out — an
   * installed app on a desktop has no browser Back.
   */
  readonly onBack?: (() => void) | undefined
  readonly scroll?: boolean
  /** Room for two `Columns` side by side on a desktop; one column on a phone either way. */
  readonly wide?: boolean
  readonly testID?: string | undefined
}

/**
 * The outermost element of every route. Owns safe-area insets, the page background and the one
 * horizontal padding value, so no screen sets any of them. See docs/08-frontend.md.
 */
export function Screen({
  title,
  children,
  footer,
  header,
  onBack,
  scroll = true,
  wide = false,
  testID,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const body = (
    <Stack gap="lg" grow>
      {onBack === undefined ? (
        title === undefined ? null : (
          <Text variant="title">{title}</Text>
        )
      ) : (
        <Stack direction="row" align="center" gap="sm">
          <IconButton
            name="back"
            label="Back"
            edge="start"
            tone="default"
            onPress={onBack}
            // The screen's own: a stack keeps the screens behind mounted, each with its Back.
            testID={`${testID ?? 'screen'}-back`}
          />
          <Stack grow>
            <Text variant="title">{title ?? ''}</Text>
          </Stack>
        </Stack>
      )}
      {children}
    </Stack>
  )

  return (
    <View
      testID={testID}
      style={[styles.page, { paddingTop: header === undefined ? insets.top : 0 }]}
    >
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, wide ? styles.wide : null]}
          keyboardShouldPersistTaps="handled"
          testID="screen-scroll"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.content, wide ? styles.wide : null]}>{body}</View>
      )}
      {footer === undefined ? null : (
        <View
          style={[
            styles.footer,
            wide ? styles.wide : null,
            { paddingBottom: insets.bottom + space.md },
          ]}
        >
          {footer}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  /**
   * Capped and centred. A form stretched across 1280px of tablet reads badly — the eye travels the
   * whole width for a field that needs a fifth of it — and this is the one place to say so, since
   * every route is a Screen.
   */
  content: {
    flexGrow: 1,
    padding: space.lg,
    gap: space.lg,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  wide: { maxWidth: WIDE_CONTENT_MAX_WIDTH },
  footer: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
})
