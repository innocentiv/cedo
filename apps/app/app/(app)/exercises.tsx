import { Screen, Text } from '../../src/ui/index.ts'

/** Placeholder until M9 fills this in. It exists now so the shell has a real route to land on. */
export default function Exercises(): React.JSX.Element {
  return (
    <Screen title="Exercises" testID="exercises-screen">
      <Text tone="muted">Coming in the next milestone.</Text>
    </Screen>
  )
}
