import { ScrollView, StyleSheet, View } from 'react-native'
import { Stack } from './stack.tsx'
import { space } from './tokens.ts'
import { useLayout } from './use-layout.ts'

/** The column that only leads to the other. */
export type Narrow = 'main' | 'side'

/**
 * What a part of a screen is doing, and what it is doing it within (#24 review): on a phone one
 * column, the main part first; on a desktop side by side, so neither is stretched across the whole
 * width — a Log button 700 points wide read as the most important thing on the screen, which on a
 * desk it is not. Groups are set apart by the widest gap; what is inside a group sets its own,
 * closer.
 *
 * Both columns scroll with the page. A screen whose whole body is two columns does not use this but
 * `Screen` `columns`, which on a desktop scrolls each on its own (#50); this is for two columns
 * that are a part of a page — a review, with more above and below it.
 */
export function Columns({
  main,
  side,
  narrow = 'side',
  testID,
}: {
  readonly main: React.ReactNode
  readonly side: React.ReactNode
  /**
   * The column that only leads to the other: by default the side. A list whose every row opens
   * something wider beside it — the athletes, each with their whole training (#30) — is the main
   * column, and the narrow one.
   */
  readonly narrow?: Narrow | undefined
  readonly testID?: string | undefined
}): React.JSX.Element {
  const desk = useLayout() === 'tablet'
  return (
    <Stack direction={desk ? 'row' : 'column'} align="stretch" gap="xxl" testID={testID}>
      <Stack gap="xxl" style={desk ? WIDTHS[narrow].main : null}>
        {main}
      </Stack>
      <Stack gap="xxl" style={desk ? WIDTHS[narrow].side : null}>
        {side}
      </Stack>
    </Stack>
  )
}

/**
 * Two columns on a desktop, each its own scroll (#50): what is chosen in one stays beside whatever
 * the other is scrolled to — the settings of an entry on the fifth day of a plan, not several
 * screens above it. Only `Screen` lays this out, filling the height it has between its title and
 * its footer; a screen asks for it with `Screen` `columns`.
 */
export function ScrollingColumns({
  main,
  side,
  narrow = 'side',
  chosen,
}: {
  readonly main: React.ReactNode
  readonly side: React.ReactNode
  readonly narrow?: Narrow | undefined
  /** What the side shows, when it shows one thing chosen: another opens at its top. */
  readonly chosen?: string | null | undefined
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <ScrollView
        style={WIDTHS[narrow].main}
        contentContainerStyle={styles.scrolled}
        keyboardShouldPersistTaps="handled"
        testID="screen-main"
      >
        {main}
      </ScrollView>
      <ScrollView
        // Its scroll is the thing chosen's: choosing another starts it at the top.
        key={chosen ?? ''}
        style={WIDTHS[narrow].side}
        contentContainerStyle={styles.scrolled}
        keyboardShouldPersistTaps="handled"
        testID="screen-side"
      >
        {side}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wider: { flex: 3 },
  narrower: { flex: 2 },
  list: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  /**
   * The screen's padding, inside each scroll rather than around it, so nothing at a column's edge —
   * a field's focus ring — is cut off by it. Half the gap between the columns each, together the
   * widest gap, as `Columns` sets them apart.
   */
  scrolled: { padding: space.lg, gap: space.xxl },
})

/** Each column's share of the width, by which is the narrow one. */
const WIDTHS = {
  side: { main: styles.wider, side: styles.narrower },
  main: { main: styles.list, side: styles.wider },
} as const
