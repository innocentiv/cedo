import { Pressable, ScrollView, StyleSheet } from 'react-native'
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

/** A single-choice row. Used for list scopes and any other short, flat set of options. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  testID,
}: ChipsProps<T>): React.JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          accessibilityState={{ selected: option.value === value }}
          testID={`${testID ?? 'chip'}-${option.value}`}
          onPress={() => {
            onChange(option.value)
          }}
          style={[styles.chip, option.value === value ? styles.selected : null]}
        >
          <Text variant="caption" tone={option.value === value ? 'accent' : 'muted'}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginRight: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  selected: { borderColor: color.accent, backgroundColor: color.surfaceRaised },
})
