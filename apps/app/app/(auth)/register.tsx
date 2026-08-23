import { useState } from 'react'
import { Button, Field, FormError, Input, NavButton, Screen, Stack } from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'
import { useSubmit } from '../../src/lib/use-submit.ts'

export default function Register(): React.JSX.Element {
  const { register } = useAuth()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const { submit, busy, error, fieldError } = useSubmit()

  const onSubmit = () => {
    void submit(async () => {
      await register({ username, password, displayName })
    })
  }

  return (
    <Screen title="Create an account" testID="register-screen">
      <Stack gap="lg">
        <Field
          label="Username"
          error={fieldError('username')}
          hint="Letters, numbers, dot, underscore, hyphen."
        >
          <Input value={username} onChangeText={setUsername} autoFocus testID="register-username" />
        </Field>
        <Field label="Display name" error={fieldError('displayName')}>
          <Input
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="sentences"
            testID="register-display-name"
          />
        </Field>
        <Field label="Password" error={fieldError('password')} hint="At least 8 characters.">
          <Input
            value={password}
            onChangeText={setPassword}
            secure
            onSubmitEditing={onSubmit}
            testID="register-password"
          />
        </Field>
        <FormError message={error} testID="register-error" />
        <Button title="Create account" onPress={onSubmit} busy={busy} testID="register-submit" />
        <NavButton title="I already have one" href="/login" testID="to-login" />
      </Stack>
    </Screen>
  )
}
