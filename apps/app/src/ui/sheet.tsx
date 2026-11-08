import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONTENT_MAX_WIDTH, color, radius, space } from './tokens.ts'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { useLayout } from './use-layout.ts'

export interface SheetProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children: React.ReactNode
  readonly testID: string
}

/**
 * Something looked at without leaving where you are — how to do an exercise mid-set, a session's
 * menu. On a phone it rises from the bottom, under the thumb; on a desktop it opens in the middle,
 * where the eye already is. A tap on the dimmed screen around it, or the × at the content's edge,
 * puts it away. Never for a step of a flow: what is done in a sheet is done when it closes.
 */
export function Sheet({ open, onClose, title, children, testID }: SheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const desk = useLayout() === 'tablet'
  return (
    <Modal
      visible={open}
      transparent
      animationType={desk ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, desk ? styles.centred : null]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          testID={testID}
          style={[styles.sheet, desk ? styles.dialog : { paddingBottom: insets.bottom + space.lg }]}
        >
          <Stack direction="row" align="center" gap="md" style={styles.gutter}>
            <Stack grow>
              <Text variant="heading">{title}</Text>
            </Stack>
            <IconButton
              name="close"
              label="Close"
              edge="end"
              onPress={onClose}
              testID={`${testID}-close`}
            />
          </Stack>
          {/* A focused field above the keyboard, as a browser keeps it: see `Screen`. */}
          <ScrollView
            contentContainerStyle={[styles.gutter, styles.body]}
            automaticallyAdjustKeyboardInsets
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
  centred: { justifyContent: 'center', padding: space.xl },
  sheet: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    maxHeight: '85%',
    alignSelf: 'center',
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.md,
    gap: space.md,
  },
  /**
   * The side padding, on the title and inside the scroll — not on the sheet — so the scroll runs to
   * the sheet's edge and its bar sits in the gutter, not over the content (#61).
   */
  gutter: { paddingHorizontal: space.lg },
  dialog: { borderRadius: radius.lg, paddingBottom: space.lg },
  body: { gap: space.lg, paddingBottom: space.md },
})
