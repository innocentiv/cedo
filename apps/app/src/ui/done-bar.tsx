import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native'
import { color, space, stroke } from './tokens.ts'
import { Text } from './text.tsx'

/**
 * Above iOS's number pad, which has no key to put it away. Safari gives a numeric field a bar with
 * Done; the native app gives it the same (#77). Without it the pad covered the logger's Log button,
 * and nothing on the screen said that a tap elsewhere would lower it. A field shows it by spreading
 * `onDoneBar(id)` into its props, beside `<DoneBar id={id} />` (`TypedNumber`). Nothing anywhere
 * but iOS.
 *
 * React Native 0.88 marks `InputAccessoryView` deprecated, naming nothing in its place. It is iOS's
 * own way to put a bar on the keyboard, and the only one that also reaches a field in a `Sheet`,
 * which is a window of its own; the day it is removed, the typecheck says so.
 */
const ios = Platform.OS === 'ios'

/** The props that put a field's keyboard under the bar `id` names. */
export const onDoneBar = (id: string): { readonly inputAccessoryViewID?: string } =>
  ios ? { inputAccessoryViewID: id } : {}

export function DoneBar({ id }: { readonly id: string }): React.JSX.Element | null {
  if (!ios) return null
  return (
    <InputAccessoryView nativeID={id}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => {
            Keyboard.dismiss()
          }}
          accessibilityRole="button"
          hitSlop={space.sm}
          testID="keyboard-done"
        >
          <Text variant="label">Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.surfaceRaised,
    borderTopWidth: stroke.hairline,
    borderTopColor: color.border,
  },
})
