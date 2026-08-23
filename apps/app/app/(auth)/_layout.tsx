import { Redirect, Stack } from 'expo-router'
import { useAuth } from '../../src/auth/auth-provider.tsx'

export default function AuthLayout(): React.JSX.Element {
  const { status } = useAuth()
  // Signing in while already signed in is not a state worth having.
  if (status === 'signed-in') return <Redirect href="/today" />
  return <Stack screenOptions={{ headerShown: false }} />
}
