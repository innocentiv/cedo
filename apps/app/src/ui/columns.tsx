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
      <Stack gap="xxl" style={desk ? (narrow === 'main' ? styles.lead : styles.main) : null}>
        {main}
      </Stack>
      <Stack gap="xxl" style={desk ? (narrow === 'main' ? styles.wide : styles.side) : null}>
        {side}
      </Stack>
    </Stack>
  )
}

const styles = StyleSheet.create({
  main: { flex: 3 },
  side: { flex: 2 },
  lead: { flex: 1 },
  wide: { flex: 3 },
})
