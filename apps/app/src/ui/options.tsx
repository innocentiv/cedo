import { Pressable, StyleSheet, View } from 'react-native'
import { Icon } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { CONTROL_HEIGHT, color, radius, space } from './tokens.ts'

/**
 * What a filter's sheet holds (#52), laid out for how many there are: a few, one per line
 * (`OptionRow`); many, in a grid (`OptionGrid`); headed parts of either (`OptionSection`).
 */

/** A choice in a sheet of few: one per line, a word on it if it needs one, ticked when chosen. */
export function OptionRow({
  label,
  detail,
  selected,
  onPress,
  testID,
}: {
  readonly label: string
  readonly detail?: string | undefined
  readonly selected: boolean
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      aria-selected={selected}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.chosen : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Stack grow gap="xs">
        <Text numberOfLines={1}>{label}</Text>
        {detail === undefined ? null : (
          <Text variant="caption" tone="muted">
            {detail}
          </Text>
        )}
      </Stack>
      {selected ? <Icon name="check" /> : null}
    </Pressable>
  )
}

/**
 * A choice in a sheet of many — thirty-four muscles: cells of one width, `columns` to a line, so a
 * long list reads as a table rather than a ragged wall of chips.
 */
export function OptionGrid<T extends string>({
  options,
  value,
  onChoose,
  columns,
  testID,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly value: T | null
  readonly onChoose: (value: T) => void
  readonly columns: number
  readonly testID: string
}): React.JSX.Element {
  const lines = Array.from({ length: Math.ceil(options.length / columns) }, (_, i) =>
    options.slice(i * columns, (i + 1) * columns),
  )
  return (
    <View style={styles.grid}>
      {lines.map((line) => (
        <View key={line[0]?.value} style={styles.gridLine}>
          {line.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              aria-selected={option.value === value}
              onPress={() => {
                onChoose(option.value)
              }}
              testID={`${testID}-${option.value}`}
              style={({ pressed }) => [
                styles.cell,
                option.value === value ? styles.chosen : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.cellLabel}>
                <Text variant="caption" numberOfLines={1}>
                  {option.label}
                </Text>
              </View>
              {option.value === value ? <Icon name="check" size="small" /> : null}
            </Pressable>
          ))}
          {/* The last line's empty cells, so its cells keep the width of the rest. */}
          {Array.from({ length: columns - line.length }, (_, i) => (
            <View key={`empty-${String(i)}`} style={[styles.cell, styles.empty]} />
          ))}
        </View>
      ))}
    </View>
  )
}

/** A headed part of a sheet: Upper body, Your groups. */
export function OptionSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <Stack gap="sm">
      <Text variant="label" tone="muted">
        {title}
      </Text>
      {children}
    </Stack>
  )
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  row: {
    minHeight: CONTROL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  chosen: { backgroundColor: color.surfaceRaised },
  grid: { gap: space.sm },
  gridLine: { flexDirection: 'row', gap: space.sm },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: CONTROL_HEIGHT,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  cellLabel: { flex: 1 },
  // A cell's box, unseen: the same padding and border, so the line's cells keep one width.
  empty: { borderColor: 'transparent' },
})
