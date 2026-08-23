import { Button, Screen, Stack, Text } from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'

export default function Settings(): React.JSX.Element {
  const { me, signOut } = useAuth()
  return (
    <Screen title="Settings" testID="settings-screen">
      <Stack gap="lg">
        <Text tone="muted">
          {me === null ? '' : `${me.user.username} · ${me.groups.length} groups`}
        </Text>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => {
            void signOut()
          }}
          testID="sign-out"
        />
      </Stack>
    </Screen>
  )
}
