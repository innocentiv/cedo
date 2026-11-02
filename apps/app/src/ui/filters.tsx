import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Icon, IconButton, type IconName } from './icon.tsx'
import { Sheet } from './sheet.tsx'
import { Text } from './text.tsx'
import { color, radius, space } from './tokens.ts'

/**
 * How a list is narrowed (#52): one look for every filter, wherever a list is filtered. Each is a
 * trigger saying its value — `All Muscles`, `Mine` — beside the glyph saying what it narrows; each
 * opens a sheet of its own, laid out for its own options (`OptionRow`, `OptionGrid`).
 */

/**
 * The filters of one list, on one line however long their values: wider than the screen, the line
 * scrolls sideways. Held to its own height — a horizontal ScrollView has none, and once grew to fill
 * the screen over an empty list (see `Chips`). `onClear`, given while any filter is off its default,
 * puts them all back; the search typed beside them is the reader's, and is left alone.
 */
export function FilterRow({
  children,
  onClear,
  testID,
}: {
  readonly children: React.ReactNode
  readonly onClear: (() => void) | undefined
  readonly testID: string
}): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.line}
      contentContainerStyle={styles.lineContent}
      testID={testID}
    >
      {children}
      {onClear === undefined ? null : (
        <IconButton
          name="close"
          label="Clear filters"
          onPress={onClear}
          testID={`${testID}-clear`}
        />
      )}
    </ScrollView>
  )
}

/**
 * One filter whole: its trigger, and the sheet it opens. What is in the sheet is the filter's own —
 * a list, a grid — given `choose`, which takes the choice and closes it, as choosing any filter's
 * option does.
 */
export function FilterSheet({
  icon,
  label,
  value,
  active,
  testID,
  children,
}: {
  readonly icon: IconName
  /** What it narrows: said aloud before the value, and the sheet's title. */
  readonly label: string
  readonly value: string
  readonly active: boolean
  readonly testID: string
  readonly children: (choose: (take: () => void) => void) => React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <FilterTrigger
        icon={icon}
        label={label}
        value={value}
        active={active}
        onPress={() => {
          setOpen(true)
        }}
        testID={testID}
      />
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title={label}
        testID={`${testID}-sheet`}
      >
        {children((take) => {
          take()
          setOpen(false)
        })}
      </Sheet>
    </>
  )
}

/** One filter: what it narrows, by glyph; its value, cut short past a width; filled when it narrows. */
export function FilterTrigger({
  icon,
  label,
  value,
  active,
  onPress,
  testID,
}: {
  readonly icon: IconName
  /** What it narrows, said aloud before its value: "Muscle". */
  readonly label: string
  readonly value: string
  /** Off its default: the list is narrowed by it. */
  readonly active: boolean
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.trigger,
        active ? styles.active : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Icon name={icon} size="small" tone={active ? 'onAccent' : 'muted'} />
      <View style={styles.value}>
        <Text
          variant="caption"
          tone={active ? 'onAccent' : 'default'}
          numberOfLines={1}
          testID={`${testID}-value`}
        >
          {value}
        </Text>
      </View>
      <Icon name="down" size="small" tone={active ? 'onAccent' : 'muted'} />
    </Pressable>
  )
}

/** A trigger's value is cut short past this, so one long group name cannot take the line. */
const VALUE_MAX_WIDTH = 160

const styles = StyleSheet.create({
  line: { flexGrow: 0, flexShrink: 0 },
  lineContent: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  active: { borderColor: color.accent, backgroundColor: color.accent },
  value: { maxWidth: VALUE_MAX_WIDTH },
  pressed: { opacity: 0.6 },
})
