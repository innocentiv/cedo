import { Redirect, Stack } from 'expo-router'
import { useAuth } from '../../src/auth/auth-provider.tsx'

export default function AuthLayout(): React.JSX.Element {
  const { status } = useAuth()
  // Signing in while already signed in is not a state worth having — nor while a session is kept
  // that the server could not be asked about: the shell says so, and offers signing out.
  if (status === 'signed-in' || status === 'unreachable') return <Redirect href="/today" />
  return <Stack screenOptions={{ headerShown: false }} />
}
