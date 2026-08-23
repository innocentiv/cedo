import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, space } from './tokens.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface ScreenProps {
  readonly title?: string | undefined
  readonly children: React.ReactNode
  /** Pinned to the bottom, outside the scroll area — where a primary action belongs. */
  readonly footer?: React.ReactNode | undefined
  readonly scroll?: boolean
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
  scroll = true,
  testID,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const body = (
    <Stack gap="lg" grow>
      {title === undefined ? null : <Text variant="title">{title}</Text>}
      {children}
    </Stack>
  )

  return (
    <View testID={testID} style={[styles.page, { paddingTop: insets.top }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          testID="screen-scroll"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={styles.content}>{body}</View>
      )}
      {footer === undefined ? null : (
        <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, padding: space.lg, gap: space.lg },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
})
