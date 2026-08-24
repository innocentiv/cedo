import { StyleSheet, Text as RNText, type TextProps as RNTextProps } from 'react-native'
import { type TypeVariant, color, type as typeScale } from './tokens.ts'

export type Tone = 'default' | 'muted' | 'faint' | 'danger' | 'success' | 'accent'

const TONE: Record<Tone, string> = {
  default: color.text,
  muted: color.textMuted,
  faint: color.textFaint,
  danger: color.danger,
  success: color.success,
  accent: color.accent,
}

export interface TextProps extends Omit<RNTextProps, 'style'> {
  readonly variant?: TypeVariant | undefined
  readonly tone?: Tone | undefined
  readonly align?: 'left' | 'center' | 'right'
  /**
   * Opt in to selection. Text is unselectable by default so a long-press does what the screen
   * intended, but a value the user must copy out — an access token, shown exactly once — has to be
   * selectable or the screen is useless.
   */
  readonly selectable?: boolean | undefined
}

/**
 * The only way text reaches the screen. Raw `<Text>` in a screen file is a lint-visible smell: it
 * means someone chose a size or a colour outside the scale. See docs/08-frontend.md.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  align = 'left',
  selectable = false,
  ...rest
}: TextProps): React.JSX.Element {
  return (
    <RNText
      {...rest}
      selectable={selectable}
      style={[
        selectable ? styles.selectable : styles.base,
        typeScale[variant],
        { color: TONE[tone], textAlign: align },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  base: {
    // Web only; harmless elsewhere. Without it every label is selectable and long-presses select
    // text instead of doing what the screen intended.
    userSelect: 'none',
  },
  selectable: { userSelect: 'text' },
})
