import { forwardRef } from 'react'
import { Pressable, type PressableProps, StyleSheet, type View } from 'react-native'
import { CONTROL_HEIGHT, color, radius, space } from './tokens.ts'
import { Text } from './text.tsx'

export interface NavItemProps extends PressableProps {
  readonly label: string
  /** Supplied by `TabTrigger` when used with `asChild`. */
  readonly isFocused?: boolean | undefined
  readonly horizontal?: boolean | undefined
}

/**
 * One entry in the navigation, in both arrangements. It is a `Pressable` so `TabTrigger asChild`
 * can hand it press handlers and the focused flag, and it renders nothing router-specific itself.
 */
export const NavItem = forwardRef<View, NavItemProps>(function NavItem(
  { label, isFocused = false, horizontal = false, ...rest },
  ref,
) {
  return (
    <Pressable
      {...rest}
      ref={ref}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      testID={`nav-${label.toLowerCase()}`}
      style={[
        styles.item,
        horizontal ? styles.horizontal : styles.stacked,
        isFocused ? styles.focused : null,
      ]}
    >
      <Text
        variant="label"
        tone={isFocused ? 'accent' : 'muted'}
        align={horizontal ? 'center' : 'left'}
      >
        {label}
      </Text>
    </Pressable>
  )
})
NavItem.displayName = 'NavItem'

const styles = StyleSheet.create({
  item: {
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  horizontal: { flex: 1 },
  /** In the sidebar an item fills the width and reads from the left, like every sidebar. */
  stacked: { alignSelf: 'stretch', alignItems: 'flex-start' },
  focused: { backgroundColor: color.surfaceRaised },
})
