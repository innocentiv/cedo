import { useEffect, useRef, useState } from 'react'
import { StyleSheet, TextInput } from 'react-native'
import { COUNT, type Typing } from '@cedo/contract'
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

/**
 * A small caption over a numeric control, for rows of numbers side by side: a set's targets, the
 * logger's inputs, a progression's increments. Labels are lowercase, like the units beside them.
 */
export function CompactField({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Stack gap="xs" grow>
      <Text variant="caption" tone="faint">
        {label}
      </Text>
      {children}
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

export interface TypedNumberProps {
  /** Null means empty. An empty numeric field is not zero — zero reps is a meaningful log. */
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  /** The text for a value, and what typed text means: `COUNT` or a `DIMENSION_FIELDS` entry. */
  readonly typing: Typing
  readonly placeholder?: string | undefined
  readonly testID?: string | undefined
}

/**
 * The typing mechanics every numeric field shares. What the text MEANS — units, separators,
 * decimals — is the contract's (`DIMENSION_FIELDS`, `COUNT`); this only keeps the right text on
 * screen while it is typed.
 *
 * While focused, the field shows the TEXT being typed, not the number it parses to. Rendering from
 * the number made "62." collapse to "62" under the cursor, so typing 62.5 key by key logged 625 kg;
 * and a parent that refuses an empty field (sets snap back to 1) put a digit back mid-edit, so
 * backspace-then-4 made 14. On blur it shows the parent's value again, whatever that settled to.
 *
 * A value change the field did NOT cause resets the text even while focused. On native the keyboard
 * can stay up while another control is tapped — removing or moving an entry — and the editors are
 * keyed by position, so this same component then holds a different entry's value; keeping the old
 * text made the next digit write old-text-plus-digit into the wrong entry. "Caused by this field"
 * means: changed in the render right after its own keystroke, which is when a parent's clamp lands.
 */
export function TypedNumber({
  value,
  onChange,
  typing,
  placeholder,
  testID,
}: TypedNumberProps): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [previous, setPrevious] = useState(value)
  const ownKeystroke = useRef(false)
  if (value !== previous) {
    setPrevious(value)
    if (!ownKeystroke.current) setEditing(null)
  }
  // The flag lives for one render: the one the keystroke itself caused.
  useEffect(() => {
    ownKeystroke.current = false
  })
  const shown = typing.toText(value)
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
        const typed = typing.parse(text)
        ownKeystroke.current = true
        setEditing(typed.text)
        onChange(typed.value)
      }}
      placeholder={placeholder}
      placeholderTextColor={color.textFaint}
      inputMode={typing.decimals ? 'decimal' : 'numeric'}
      style={[styles.input, styles.numeric]}
    />
  )
}

export interface NumberInputProps {
  /** Null means empty. An empty numeric field is not zero — zero reps is a meaningful log. */
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  readonly placeholder?: string | undefined
  readonly testID?: string | undefined
}

/** A plain whole number — a count. A measured quantity is a `DimensionInput`. */
export function NumberInput(props: NumberInputProps): React.JSX.Element {
  return <TypedNumber {...props} typing={COUNT} />
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
