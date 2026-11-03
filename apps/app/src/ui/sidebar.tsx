import { Pressable, StyleSheet } from 'react-native'
import { BrandHeading } from './brand.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { space } from './tokens.ts'

/** The product's name and its mark, at the head of a desktop's sidebar (#29, #61). */
export function SidebarName({ name }: { readonly name: string }): React.JSX.Element {
  return (
    <Stack style={styles.name}>
      <BrandHeading text={name} testID="sidebar-name" />
    </Stack>
  )
}

/** Who is signed in, at the foot of a desktop's sidebar (#29): a tap to where the account is. */
export function SidebarAccount({
  name,
  handle,
  onPress,
}: {
  readonly name: string
  readonly handle: string
  readonly onPress: () => void
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, settings`}
      onPress={onPress}
      testID="sidebar-account"
      style={({ pressed }) => [styles.account, pressed ? styles.pressed : null]}
    >
      <Text variant="label" numberOfLines={1}>
        {name}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {handle}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  name: { paddingHorizontal: space.md, paddingBottom: space.lg },
  account: { paddingHorizontal: space.md, paddingVertical: space.sm },
  // As the session's band fades, pressed: one press, one look.
  pressed: { opacity: 0.85 },
})
