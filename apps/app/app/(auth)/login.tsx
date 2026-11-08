import { useState } from 'react'
import { Platform } from 'react-native'
import { Redirect } from 'expo-router'
import {
  Button,
  Field,
  FormError,
  FrontDoor,
  Input,
  NavButton,
  Stack,
  Text,
} from '../../src/ui/index.ts'
import { useInstance } from '../../src/api/queries.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'
import { hostOf } from '../../src/auth/server.ts'
import { useSubmit } from '../../src/lib/use-submit.ts'

export default function Login(): React.JSX.Element {
  const { signIn, server } = useAuth()
  const instance = useInstance()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { submit, busy, error, fieldError } = useSubmit()

  const onSubmit = () => {
    void submit(async () => {
      await signIn({ username, password })
    })
  }
  // On native, which server comes first (#78).
  if (Platform.OS !== 'web' && server.status === 'none') return <Redirect href="/server" />

  return (
    <FrontDoor testID="login-screen">
      <Stack gap="lg">
        <Field label="Username" error={fieldError('username')}>
          <Input
            value={username}
            onChangeText={setUsername}
            autoComplete="username"
            autoFocus
            testID="login-username"
          />
        </Field>
        <Field label="Password" error={fieldError('password')}>
          <Input
            value={password}
            onChangeText={setPassword}
            secure
            autoComplete="current-password"
            onSubmitEditing={onSubmit}
            testID="login-password"
          />
        </Field>
        <FormError message={error} testID="login-error" />
        <Button title="Sign in" onPress={onSubmit} busy={busy} testID="login-submit" />
        {/* Offered unless the instance says it takes no new accounts (#71). */}
        {instance.data?.signUp === 'closed' ? null : (
          <NavButton title="Create an account" href="/register" testID="to-register" />
        )}
        {/* One server at a time; changing it is done signed out, from here (#78). */}
        {server.base === null ? null : (
          <Stack gap="xs" align="center">
            <Text variant="caption" tone="faint" testID="login-server">
              {hostOf(server.base)}
            </Text>
            <NavButton
              title="Change server"
              href="/server"
              variant="ghost"
              testID="change-server"
            />
          </Stack>
        )}
      </Stack>
    </FrontDoor>
  )
}
