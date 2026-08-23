import { Screen, Stack, Text } from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'

/** Placeholder until M9 fills it in. It exists now so the shell has a real route to land on. */
export default function Today(): React.JSX.Element {
  const { me } = useAuth()
  return (
    <Screen title="Today" testID="today-screen">
      <Stack gap="md">
        <Text tone="muted">
          {me === null ? 'Loading…' : `Signed in as ${me.user.displayName}.`}
        </Text>
      </Stack>
    </Screen>
  )
}
