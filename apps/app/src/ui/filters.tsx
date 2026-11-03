import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Icon, IconButton, type IconName } from './icon.tsx'
import { Sheet } from './sheet.tsx'
import { Text } from './text.tsx'
import { color, radius, space, stroke } from './tokens.ts'

/**
 * How a list is narrowed (#52): one look for every filter, wherever a list is filtered. Each is a
 * trigger saying its value — `Muscles`, `Mine` — beside the glyph saying what it narrows; each
 * opens a sheet of its own, laid out for its own options (`OptionRow`, `OptionGrid`).
 */

/**
 * The filters of one list, as one bar of segments — the look of reps in reserve
 * (`ReserveChips`) — the width of the list: each in view, its value cut short in its own segment,
 * never the bar cut at the screen's edge, as a line of pills scrolling sideways was. `onClear`,
 * given while any filter is off its default, puts them all back, beside the bar; the search typed
 * above them is the reader's, and is left alone.
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
    <View style={styles.line}>
      <View style={styles.bar} testID={testID}>
        {children}
      </View>
      {onClear === undefined ? null : (
        <IconButton
          name="close"
          label="Clear filters"
          onPress={onClear}
          testID={`${testID}-clear`}
        />
      )}
    </View>
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

/**
 * One filter, a segment of its bar: what it narrows, by glyph; its value, cut short to the segment;
 * filled when it narrows.
 */
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
        styles.segment,
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

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bar: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    overflow: 'hidden',
  },
  /**
   * Each as wide as what it says, then an equal share of what is left — so a short "All" leaves room
   * for "My Equipment"; past the bar's width, each value is cut short. Each draws the line before it
   * — the first's falls under the bar's own edge, clipped, so no segment needs to know it is first.
   */
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    marginLeft: -stroke.hairline,
    borderLeftWidth: stroke.hairline,
    borderLeftColor: color.border,
  },
  active: { backgroundColor: color.accent },
  value: { flexShrink: 1 },
  pressed: { opacity: 0.6 },
})
