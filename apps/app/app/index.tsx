import { Redirect } from 'expo-router'
import { Spinner } from '../src/ui/index.ts'
import { useAuth } from '../src/auth/auth-provider.tsx'

/**
 * The only place that decides where a cold start lands.
 *
 * Held on a spinner while the stored token is being read: treating "not known yet" as "signed out"
 * flashes the login screen at a returning user for one frame. Unreachable lands in the signed-in
 * shell, which says so: the session is kept, not ended. On native, with no server chosen yet, the
 * server screen comes before anything (#78). See docs/08-frontend.md.
 */
export default function Index(): React.JSX.Element {
  const { status, server } = useAuth()
  if (server.status === 'none') return <Redirect href="/server" />
  if (status === 'loading') return <Spinner testID="boot-spinner" />
  return <Redirect href={status === 'signed-out' ? '/login' : '/today'} />
}
