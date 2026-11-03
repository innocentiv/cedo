import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Icon } from './icon.tsx'
import { segmented } from './segmented.ts'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { CONTROL_HEIGHT, SEGMENT_FIT, color, radius, space } from './tokens.ts'

/**
 * One choice among alternatives (docs/08-frontend.md, the UI vocabulary): `Segmented` when its
 * options all fit one line — a few short ones, or many tiny ones — and `Select`, a vertical list,
 * when they do not. Which of the two is decided by the options (`Choice`), never by the screen. A
 * chip looks like one of many that can be on, so a single choice is never chips.
 */

export interface ChoiceOption<T extends string> {
  readonly value: T
  readonly label: string
}

interface ChoiceProps<T extends string> {
  readonly options: readonly ChoiceOption<T>[]
  /** Null: none chosen yet. */
  readonly value: T | null
  readonly onChange: (value: T) => void
  /** Given, tapping the chosen one again takes the answer back: not said needs no option. */
  readonly onClear?: (() => void) | undefined
  /** Numbers read in the numerals' face — reps, reps in reserve. */
  readonly numeric?: boolean | undefined
  /** Shown, not changed: a reader's view of a plan. */
  readonly disabled?: boolean | undefined
  /** Said aloud for an option whose label alone is not enough — `2` is "2 in reserve". */
  readonly spoken?: ((option: ChoiceOption<T>) => string) | undefined
  readonly testID: string
}

/** Whether every option fits one line as a segment. A layout fact, not a domain rule. */
export const fitsOneLine = (options: readonly ChoiceOption<string>[]): boolean =>
  options.reduce(
    (width, o) => width + o.label.length * SEGMENT_FIT.charWidth + SEGMENT_FIT.padding,
    0,
  ) <= SEGMENT_FIT.lineWidth

/** `Segmented` while the options fit one line, else `Select`. */
export function Choice<T extends string>(props: ChoiceProps<T>): React.JSX.Element {
  return fitsOneLine(props.options) ? <Segmented {...props} /> : <Select {...props} />
}

/** One bar of equal segments, one chosen: the look reps in reserve and the filters share. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  onClear,
  numeric = false,
  disabled = false,
  spoken,
  testID,
}: ChoiceProps<T>): React.JSX.Element {
  return (
    <View style={[segmented.bar, styles.bar]} testID={testID}>
      {options.map((option, i) => {
        const chosen = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={spoken?.(option) ?? option.label}
            aria-selected={chosen}
            disabled={disabled}
            onPress={() => {
              if (chosen && onClear !== undefined) onClear()
              else onChange(option.value)
            }}
            testID={`${testID}-${option.value}`}
            style={({ pressed }) => [
              styles.segment,
              i > 0 ? segmented.divided : null,
              chosen ? styles.chosen : null,
              pressed && !disabled ? styles.pressed : null,
            ]}
          >
            <Text
              variant={numeric ? 'mono' : 'caption'}
              tone={chosen ? 'default' : 'muted'}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * One choice whose options do not fit a line, as a native select: the chosen one on a line of its
 * own, and — tapped — the options under it, a row each, the chosen one ticked; choosing closes it.
 */
export function Select<T extends string>({
  options,
  value,
  onChange,
  onClear,
  disabled = false,
  testID,
}: ChoiceProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const chosen = options.find((o) => o.value === value)
  return (
    <Stack gap="xs">
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        disabled={disabled}
        onPress={() => {
          setOpen((was) => !was)
        }}
        testID={testID}
        style={({ pressed }) => [styles.trigger, pressed && !disabled ? styles.pressed : null]}
      >
        <Stack grow>
          <Text tone={chosen === undefined ? 'muted' : 'default'} numberOfLines={1}>
            {chosen?.label ?? 'Choose'}
          </Text>
        </Stack>
        {disabled ? null : <Icon name={open ? 'up' : 'down'} />}
      </Pressable>
      {open ? (
        <View style={styles.list}>
          {options.map((option, i) => {
            const on = option.value === value
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                aria-selected={on}
                onPress={() => {
                  setOpen(false)
                  if (on && onClear !== undefined) onClear()
                  else onChange(option.value)
                }}
                testID={`${testID}-${option.value}`}
                style={({ pressed }) => [
                  styles.row,
                  i > 0 ? styles.divided : null,
                  on ? styles.chosen : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Stack grow>
                  <Text numberOfLines={1}>{option.label}</Text>
                </Stack>
                {on ? <Icon name="check" /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </Stack>
  )
}

const styles = StyleSheet.create({
  bar: { height: CONTROL_HEIGHT },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs },
  chosen: { backgroundColor: color.surfaceRaised },
  pressed: { backgroundColor: color.border },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  list: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: space.md,
  },
  divided: { borderTopWidth: 1, borderTopColor: color.border },
})
