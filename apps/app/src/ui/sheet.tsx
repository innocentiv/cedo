import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONTENT_MAX_WIDTH, color, radius, space } from './tokens.ts'
import { Button } from './button.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface SheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: React.ReactNode
  readonly testID: string
}

/**
 * Something looked at without leaving where you are — how to do an exercise mid-set, a session's
 * menu. Rises from the bottom, under the thumb; a tap on the dimmed screen above, or Close, puts it
 * away. Never for a step of a flow: what is done in a sheet is done when it closes.
 */
export function Sheet({ open, onClose, title, children, testID }: SheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <View testID={testID} style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
          <Stack direction="row" align="center" gap="md">
            <Stack grow>
              <Text variant="heading">{title}</Text>
            </Stack>
            <Button title="Close" variant="ghost" onPress={onClose} testID={`${testID}-close`} />
          </Stack>
          <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
  dismiss: { flex: 1 },
  sheet: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '85%',
    alignSelf: 'center',
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.md,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  body: { gap: space.lg, paddingBottom: space.md },
})
