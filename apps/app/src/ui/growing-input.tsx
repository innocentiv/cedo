import { Text as RNText, StyleSheet, TextInput, View } from 'react-native'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { CONTROL_HEIGHT, color, radius, space, type } from './tokens.ts'

/**
 * How many lines a text in paragraphs grows to before it scrolls: most of a phone's screen above
 * its keyboard, so the field never pushes what it belongs to out of reach.
 */
const GROWS_TO = 12

export interface GrowingInputProps {
  readonly value: string
  readonly onChangeText: (value: string) => void
  /** `paragraphs` grows to `GROWS_TO` lines; `line` is one line that wraps, and takes no newline. */
  readonly shape: 'paragraphs' | 'line'
  readonly placeholder?: string | undefined
  readonly autoFocus?: boolean
  readonly autoCapitalize?: 'none' | 'sentences'
  readonly invalid?: boolean
  readonly onSubmitEditing?: (() => void) | undefined
  readonly onBlur?: (() => void) | undefined
  readonly testID?: string | undefined
}

/**
 * A text field as tall as what is written in it (#51). A text input is as tall as it is told, not
 * as its text, and the web's measure of its content only ever grows: the text itself, unseen and
 * laid out the same, sizes the box the input fills — on the web and natively alike, shrinking as
 * it is deleted. Reached through `Input`'s `multiline` and `wraps`.
 */
export function GrowingInput({
  value,
  onChangeText,
  shape,
  placeholder,
  autoFocus = false,
  autoCapitalize = 'none',
  invalid = false,
  onSubmitEditing,
  onBlur,
  testID,
}: GrowingInputProps): React.JSX.Element {
  const line = shape === 'line'
  const field = (
    <View>
      <RNText
        aria-hidden
        style={[styles.box, styles.unseen, line ? styles.line : styles.paragraphs]}
      >
        {/* The space keeps a trailing newline's empty line, which a laid-out text would drop. */}
        {value === '' ? (placeholder ?? ' ') : `${value} `}
      </RNText>
      <View style={StyleSheet.absoluteFill}>
        <TextInput
          testID={testID}
          value={value}
          /**
           * A line has no newline: one that gets in — pasted, or an Enter no key event announced —
           * is a space, as the contract keeps a cue (`EntryCue`).
           */
          onChangeText={line ? (text) => onChangeText(text.replaceAll('\n', ' ')) : onChangeText}
          placeholder={placeholder}
          placeholderTextColor={color.textFaint}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline
          onSubmitEditing={onSubmitEditing}
          onBlur={onBlur}
          submitBehavior={line ? 'blurAndSubmit' : 'newline'}
          /** The web reads no `submitBehavior`: a line's Enter, from a keyboard, does nothing. */
          onKeyPress={
            line
              ? (event) => {
                  if (event.nativeEvent.key === 'Enter') event.preventDefault()
                }
              : undefined
          }
          style={[styles.box, styles.filling, invalid ? styles.invalid : null]}
        />
      </View>
    </View>
  )
  if (line) return field
  // Text in paragraphs is drawn as prose (`Prose`, #51): what a person can mark, said once, briefly.
  return (
    <Stack gap="xs">
      {field}
      <Text variant="caption" tone="faint">
        {PROSE_HINT}
      </Text>
    </Stack>
  )
}

const PROSE_HINT = '**bold**  *italic*  # heading  - list'

const styles = StyleSheet.create({
  /** The input and its unseen twin, laid out alike so the one sizes the other. */
  box: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    fontFamily: type.body.fontFamily,
  },
  unseen: { opacity: 0, borderColor: 'transparent', overflow: 'hidden' },
  paragraphs: {
    minHeight: CONTROL_HEIGHT * 2,
    maxHeight: GROWS_TO * type.body.lineHeight + 2 * space.md + 2,
  },
  /** A control's height while it is one line. */
  line: { minHeight: CONTROL_HEIGHT },
  filling: {
    flex: 1,
    backgroundColor: color.surfaceRaised,
    borderColor: color.border,
    color: color.text,
    textAlignVertical: 'top',
  },
  invalid: { borderColor: color.danger },
})
