import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import { CONTROL_HEIGHT, LOG_CONTROL_HEIGHT, color, radius, space } from './tokens.ts'
import { Text } from './text.tsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps {
  readonly title: string
  readonly onPress: () => void
  readonly variant?: ButtonVariant
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly grow?: boolean
  /** `large` where a set is logged: a thumb, between sets, without looking. */
  readonly size?: 'regular' | 'large'
  readonly testID?: string | undefined
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  grow = false,
  size = 'regular',
  testID,
}: ButtonProps): React.JSX.Element {
  // Busy implies disabled: a second tap while a mutation is in flight is the easiest way for a
  // user to log the same set twice.
  const inert = disabled || busy

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        VARIANT[variant],
        grow ? styles.grow : null,
        size === 'large' ? styles.large : null,
        pressed ? styles.pressed : null,
        inert ? styles.inert : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? color.accentText : color.text} />
      ) : (
        <Text variant="label" tone={variant === 'primary' ? 'onAccent' : TONE[variant]}>
          {title}
        </Text>
      )}
    </Pressable>
  )
}

const TONE = { secondary: 'default', ghost: 'muted', danger: 'danger' } as const

const VARIANT = StyleSheet.create({
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surfaceRaised, borderWidth: 1, borderColor: color.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.danger },
})

const styles = StyleSheet.create({
  base: {
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  large: { minHeight: LOG_CONTROL_HEIGHT, borderRadius: radius.lg },
  pressed: { opacity: 0.75 },
  inert: { opacity: 0.45 },
})
