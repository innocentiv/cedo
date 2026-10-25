import { useEffect, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import {
  COUNT,
  type FieldEvent,
  type Typing,
  editField,
  fieldShowing,
  fieldText,
} from '@cedo/contract'
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
 * None over a number shown large: its unit is on its own line (`TypedNumber`'s `unit`).
 */
export function CompactField({
  label,
  children,
}: {
  readonly label: string | null
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Stack gap="xs" grow>
      {label === null ? null : (
        <Text variant="caption" tone="faint">
          {label}
        </Text>
      )}
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
  /** When the field is left: where a text kept as it is written is saved. */
  readonly onBlur?: (() => void) | undefined
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
  onBlur,
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
      onBlur={onBlur}
      submitBehavior={multiline ? 'newline' : 'blurAndSubmit'}
      style={[styles.input, multiline ? styles.multiline : null, invalid ? styles.invalid : null]}
    />
  )
}

export interface TypedNumberProps {
  /** Null means empty. An empty numeric field is not zero — zero reps is a meaningful log. */
  readonly value: number | null
  readonly onChange: (value: number | null) => void
  /** The text for a value, and what typed text means: `COUNT`, or a dimension's `fieldFor`. */
  readonly typing: Typing
  readonly placeholder?: string | undefined
  /** `large`: the next set's numbers on the workout screen — display size, typed where they stand. */
  readonly size?: 'regular' | 'large' | undefined
  /**
   * Large only: the unit, on the number's line just after it — smaller, quieter — the pair centred
   * as one: "102.5 kg".
   */
  readonly unit?: string | undefined
  readonly testID?: string | undefined
}

/** Wires a numeric input to the contract's `editField`, which holds every typing rule. */
export function TypedNumber({
  value,
  onChange,
  typing,
  placeholder,
  size = 'regular',
  unit,
  testID,
}: TypedNumberProps): React.JSX.Element {
  const [edit, setEdit] = useState(() => fieldShowing(value))
  // From the latest state, not this render's: on native two events can land before a re-render.
  const send = (event: FieldEvent): void => {
    setEdit((current) => editField(current, event, typing).edit)
  }
  if (value !== edit.value) send({ kind: 'value', value })
  // A keystroke's window closes once the render it caused has committed.
  useEffect(() => {
    if (edit.own) send({ kind: 'settled' })
  })
  const shown = fieldText(edit, typing)
  const input = (
    <TextInput
      testID={testID}
      value={shown}
      onBlur={() => {
        send({ kind: 'blur' })
      }}
      /**
       * Focusing a prefilled numeric field selects it, so typing REPLACES the prescribed value.
       * Without it, tapping a field showing "8" and typing 8 logs 88 — into permanent history,
       * mid-workout, where nobody is checking.
       */
      selectTextOnFocus
      onChangeText={(text) => {
        const event = { kind: 'type', text } as const
        send(event)
        // What a keystroke emits depends on its text alone, so this render's state answers it.
        const { emit } = editField(edit, event, typing)
        if (emit !== undefined) onChange(emit)
      }}
      placeholder={placeholder}
      placeholderTextColor={color.textFaint}
      inputMode={typing.decimals ? 'decimal' : 'numeric'}
      style={[styles.input, styles.numeric, size === 'large' ? styles.large : null]}
    />
  )
  if (size === 'regular') return input
  /**
   * A text input is as wide as it is told, not as its text, so the unit could not sit just after
   * the number: the number's own text, unseen, sizes the box the input fills.
   */
  return (
    <Stack direction="row" align="baseline" justify="center" gap="xs">
      <View>
        <View style={styles.unseen} aria-hidden>
          <Text variant="display">{shown === '' ? (placeholder ?? ' ') : shown}</Text>
        </View>
        <View style={StyleSheet.absoluteFill}>{input}</View>
      </View>
      {unit === undefined ? null : (
        <Text variant="number" tone="faint">
          {unit}
        </Text>
      )}
    </Stack>
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
    fontFamily: type.body.fontFamily,
  },
  multiline: { minHeight: CONTROL_HEIGHT * 2, paddingTop: space.md, textAlignVertical: 'top' },
  numeric: {
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    fontFamily: type.mono.fontFamily,
    fontSize: type.mono.fontSize,
  },
  invalid: { borderColor: color.danger },
  unseen: { opacity: 0, paddingHorizontal: space.xs },
  large: {
    height: type.display.lineHeight,
    paddingVertical: 0,
    fontSize: type.display.fontSize,
    fontFamily: type.display.fontFamily,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    paddingHorizontal: 0,
  },
})
