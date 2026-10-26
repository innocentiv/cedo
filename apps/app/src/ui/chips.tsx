import { Pressable, StyleSheet, View } from 'react-native'
import { color, radius, space } from './tokens.ts'
import { Text } from './text.tsx'

export interface ChipOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface ChipsProps<T extends string> {
  readonly options: readonly ChipOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly testID?: string | undefined
}

/**
 * A single-choice row: list scopes, tracking mode, progression kind.
 *
 * Wrapped, NOT a horizontal `ScrollView`. A ScrollView carries no intrinsic height, so inside a
 * flex column it grew to fill whatever space was going — with an empty list underneath it, three
 * chips took the entire screen. Every set of options here is short enough to wrap, and a wrapped row
 * is also the one nobody has to discover a sideways gesture to use.
 */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  testID,
}: ChipsProps<T>): React.JSX.Element {
  return (
    <View style={styles.row} testID={testID}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => {
            onChange(option.value)
          }}
          testID={`${testID ?? 'chip'}-${option.value}`}
        />
      ))}
    </View>
  )
}

/** One choice of a row, on or off — the one look every set of chips shares. */
export function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      aria-selected={selected}
      testID={testID}
      onPress={onPress}
      style={[styles.chip, selected ? styles.selected : null]}
    >
      <Text variant="caption" tone={selected ? 'default' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, flexGrow: 0, flexShrink: 0 },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  selected: { borderColor: color.text, backgroundColor: color.surfaceRaised },
})
