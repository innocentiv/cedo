import type { Ref } from 'react'
import { Pressable, type PressableProps, StyleSheet, type ViewInstance } from 'react-native'
import { CONTROL_HEIGHT, color, radius, space } from './tokens.ts'
import { Text } from './text.tsx'

export interface NavItemProps extends PressableProps {
  readonly label: string
  /** Supplied by `TabTrigger` when used with `asChild`. */
  readonly isFocused?: boolean | undefined
  readonly horizontal?: boolean | undefined
  /**
   * A plain prop — React 19 passes `ref` like any other, so no `forwardRef`. `ViewInstance`, not
   * `View`: under React Native's strict TypeScript API (0.87+) `View` is the component type.
   */
  readonly ref?: Ref<ViewInstance> | undefined
}

/**
 * One entry in the navigation, in both arrangements. It is a `Pressable` so `TabTrigger asChild`
 * can hand it press handlers, a ref and the focused flag, and it renders nothing router-specific.
 */
export function NavItem({
  label,
  isFocused = false,
  horizontal = false,
  ref,
  ...rest
}: NavItemProps): React.JSX.Element {
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
}

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
