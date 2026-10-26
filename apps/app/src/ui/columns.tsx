import { StyleSheet } from 'react-native'
import { Stack } from './stack.tsx'
import { useLayout } from './use-layout.ts'

/**
 * What a screen is doing, and what it is doing it within (#24 review): on a phone one column, the
 * main part first; on a desktop side by side, so neither is stretched across the whole width — a
 * Log button 700 points wide read as the most important thing on the screen, which on a desk it is
 * not. Groups are set apart by the widest gap; what is inside a group sets its own, closer.
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
  readonly narrow?: 'main' | 'side'
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

const styles = StyleSheet.create({ wider: { flex: 3 }, narrower: { flex: 2 }, list: { flex: 1 } })

/** Each column's share of the width, by which is the narrow one. */
const WIDTHS = {
  side: { main: styles.wider, side: styles.narrower },
  main: { main: styles.list, side: styles.wider },
} as const
