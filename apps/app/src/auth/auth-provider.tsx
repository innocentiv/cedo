import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LoginInput, Me, MeUpdate, RegisterInput } from '@cedo/contract'
import { api, server, session, startUp } from '../api/http.ts'
import { WeightUnitProvider } from '../lib/weight-unit.ts'
import type { Connection, ServerSnapshot } from './server.ts'
import type { AuthStatus } from './session.ts'

/**
 * Who is signed in, and the calls that change it — the session (./session.ts), which holds every
 * rule about it, wired to React. Nothing else in the app touches the token.
 */
interface AuthValue {
  readonly status: AuthStatus
  readonly me: Me | null
  readonly signIn: (input: LoginInput) => Promise<void>
  readonly register: (input: RegisterInput) => Promise<void>
  readonly signOut: () => Promise<void>
  /** Saved to the account, so it follows them to every device — and to what the AI writes them. */
  readonly updateAccount: (patch: MeUpdate) => Promise<void>
  /** When unreachable: asks the server again about the token kept. */
  readonly retry: () => Promise<void>
  /** On native, which server (#78); on the web `served`, the page's own. */
  readonly server: ServerSnapshot
  /** An address as typed: read, checked, and kept if it is cedo — the sign-in forgotten first. */
  readonly connect: (typed: string) => Promise<Connection>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth was called outside AuthProvider')
  return value
}

/**
 * At mount, which server and who is signed in on it; and the cache emptied whenever either changes,
 * so nothing one person or one instance was told is shown to the next.
 */
function useStartUp(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    void startUp()
  }, [])
  // Another server: nothing one instance said may be shown as another's — its sign-up, above all.
  useEffect(
    () =>
      server.subscribe(() => {
        queryClient.clear()
      }),
    [queryClient],
  )
  // Signed out — by choice or because the server stopped honouring the token: nothing cached for
  // the last person may be shown to the next.
  useEffect(
    () =>
      session.subscribe(() => {
        if (session.snapshot().status === 'signed-out') queryClient.clear()
      }),
    [queryClient],
  )
}

export function AuthProvider({
  children,
}: {
  readonly children: React.ReactNode
}): React.JSX.Element {
  const { status, me } = useSyncExternalStore(session.subscribe, session.snapshot)
  const chosen = useSyncExternalStore(server.subscribe, server.snapshot)
  useStartUp()

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      signIn: async (input) => {
        await session.adopt((await api.auth.login(input)).token)
      },
      register: async (input) => {
        await session.adopt((await api.auth.register(input)).token)
      },
      signOut: session.signOut,
      updateAccount: session.update,
      retry: session.restore,
      server: chosen,
      connect: server.connect,
    }),
    [status, me, chosen],
  )

  return (
    <AuthContext.Provider value={value}>
      <WeightUnitProvider value={me?.user.weightUnit ?? 'kg'}>{children}</WeightUnitProvider>
    </AuthContext.Provider>
  )
}
