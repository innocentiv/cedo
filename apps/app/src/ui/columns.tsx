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
  testID,
}: {
  readonly main: React.ReactNode
  readonly side: React.ReactNode
  readonly testID?: string | undefined
}): React.JSX.Element {
  const desk = useLayout() === 'tablet'
  return (
    <Stack direction={desk ? 'row' : 'column'} align="stretch" gap="xxl" testID={testID}>
      <Stack gap="xxl" style={desk ? styles.main : null}>
        {main}
      </Stack>
      <Stack gap="xxl" style={desk ? styles.side : null}>
        {side}
      </Stack>
    </Stack>
  )
}

const styles = StyleSheet.create({ main: { flex: 3 }, side: { flex: 2 } })
