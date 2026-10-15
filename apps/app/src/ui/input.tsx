import { useState } from 'react'
import { StyleSheet, TextInput } from 'react-native'
import { CONTROL_HEIGHT, color, radius, space, type } from './tokens.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

export interface FieldProps {
  readonly label: string
  readonly error?: string | undefined
  readonly hint?: string | undefined
  readonly children: React.ReactNode
}

/** Label, control, and the one place an error message is allowed to appear under a control. */
export function Field({ label, error, hint, children }: FieldProps): React.JSX.Element {
  return (
    <Stack gap="xs">
      <Text variant="label" tone="muted">
        {label}
      </Text>
      {children}
      {error === undefined ? null : (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      )}
      {error === undefined && hint !== undefined ? (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      ) : null}
    </Stack>
  )
}

export interface InputProps {
  readonly value: string
  readonly onChangeText: (value: string) => void
  readonly placeholder?: string | undefined
  readonly secure?: boolean
  readonly autoFocus?: boolean
  readonly autoCapitalize?: 'none' | 'sentences'
  readonly multiline?: boolean
  readonly invalid?: boolean
  readonly onSubmitEditing?: (() => void) | undefined
  readonly testID?: string | undefined
}

export function Input({
  value,
  onChangeText,
  placeholder,
  secure = false,
  autoFocus = false,
  autoCapitalize = 'none',
  multiline = false,
  invalid = false,
  onSubmitEditing,
  testID,
}: InputProps): React.JSX.Element {
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={color.textFaint}
      secureTextEntry={secure}
      autoFocus={autoFocus}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      multiline={multiline}
      onSubmitEditing={onSubmitEditing}
      submitBehavior={multiline ? 'newline' : 'blurAndSubmit'}
      style={[styles.input, multiline ? styles.multiline : null, invalid ? styles.invalid : null]}
    />
  )
}

export interface NumberInputProps {
  /** Null means empty. An empty numeric field is not zero — zero reps is a meaningful log. */
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly placeholder?: string | undefined
  readonly decimals?: boolean
  readonly testID?: string | undefined
}

/**
 * Keeps what was typed: digits, plus — with `decimals` — ONE separator, normalised to a point. A
 * comma is the decimal key on an Italian, German or French keypad, and stripping it turned "62,5"
 * into 625.
 */
function cleanNumber(text: string, decimals: boolean): string {
  if (!decimals) return text.replaceAll(/\D/gu, '')
  const [whole = '', ...rest] = text
    .replaceAll(',', '.')
    .replaceAll(/[^\d.]/gu, '')
    .split('.')
  return rest.length === 0 ? whole : `${whole}.${rest.join('')}`
}

/**
 * While focused, the field shows the TEXT being typed, not the number it parses to. Rendering from
 * the number made "62." collapse to "62" under the cursor, so typing 62.5 key by key logged 625 kg;
 * and a parent that refuses an empty field (sets snap back to 1) put a digit back mid-edit, so
 * backspace-then-4 made 14. On blur it shows the parent's value again, whatever that settled to.
 *
 * The parse is the only arithmetic a screen is allowed to do, and it does not convert units — that
 * is `@cedo/contract`'s job. See docs/08-frontend.md.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  decimals = false,
  testID,
}: NumberInputProps): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const shown = value === null ? '' : String(value)
  return (
    <TextInput
      testID={testID}
      value={editing ?? shown}
      onFocus={() => {
        setEditing(shown)
      }}
      onBlur={() => {
        setEditing(null)
      }}
      /**
       * Focusing a prefilled numeric field selects it, so typing REPLACES the prescribed value.
       * Without it, tapping a field showing "8" and typing 8 logs 88 — into permanent history,
       * mid-workout, where nobody is checking.
       */
      selectTextOnFocus
      onChangeText={(text) => {
        const cleaned = cleanNumber(text, decimals)
        setEditing(cleaned)
        if (cleaned === '' || cleaned === '.') {
          onChange(null)
          return
        }
        const parsed = Number(cleaned)
        if (Number.isFinite(parsed)) onChange(parsed)
      }}
      placeholder={placeholder}
      placeholderTextColor={color.textFaint}
      inputMode={decimals ? 'decimal' : 'numeric'}
      style={[styles.input, styles.numeric]}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surfaceRaised,
    borderWidth: 1,
    borderColor: color.border,
    color: color.text,
    fontSize: type.body.fontSize,
  },
  multiline: { minHeight: CONTROL_HEIGHT * 2, paddingTop: space.md, textAlignVertical: 'top' },
  numeric: { textAlign: 'center', fontVariant: ['tabular-nums'] },
  invalid: { borderColor: color.danger },
})
