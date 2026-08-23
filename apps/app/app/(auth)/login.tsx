import { useState } from 'react'
import {
  Button,
  Field,
  FormError,
  Input,
  NavButton,
  Screen,
  Stack,
  Text,
} from '../../src/ui/index.ts'
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
    <Screen title="cedo" testID="login-screen">
      <Stack gap="lg">
        <Text tone="muted">Sign in to your instance.</Text>
        <Field label="Username" error={fieldError('username')}>
          <Input
            value={username}
            onChangeText={setUsername}
            placeholder="valerio"
            autoFocus
            testID="login-username"
          />
        </Field>
        <Field label="Password" error={fieldError('password')}>
          <Input
            value={password}
            onChangeText={setPassword}
            secure
            onSubmitEditing={onSubmit}
            testID="login-password"
          />
        </Field>
        <FormError message={error} testID="login-error" />
        <Button title="Sign in" onPress={onSubmit} busy={busy} testID="login-submit" />
        <NavButton title="Create an account" href="/register" testID="to-register" />
      </Stack>
    </Screen>
  )
}
