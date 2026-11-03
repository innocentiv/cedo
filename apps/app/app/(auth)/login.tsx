import { useState } from 'react'
import { Button, Field, FormError, FrontDoor, Input, NavButton, Stack } from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'
import { useSubmit } from '../../src/lib/use-submit.ts'

export default function Login(): React.JSX.Element {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { submit, busy, error, fieldError } = useSubmit()

  const onSubmit = () => {
    void submit(async () => {
      await signIn({ username, password })
    })
  }

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
        <NavButton title="Create an account" href="/register" testID="to-register" />
      </Stack>
    </FrontDoor>
  )
}
