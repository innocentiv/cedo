import { Pressable, StyleSheet } from 'react-native'
import { color, radius, space } from './tokens.ts'
import { Text } from './text.tsx'

/**
 * One choice of a set, on or off — what the multi-select pickers are built of: muscles, equipment,
 * the equipment checklist. Never a single choice among alternatives: that is `Choice`.
 */
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
