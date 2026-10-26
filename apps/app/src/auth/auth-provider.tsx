import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { LoginInput, Me, RegisterInput, WeightUnit } from '@cedo/contract'
import { api, session } from '../api/http.ts'
import { forgetThisDevice, useThisDeviceKept } from '../lib/rest-alerts.ts'
import { WeightUnitProvider } from '../lib/weight-unit.ts'
import type { AuthStatus } from './session.ts'

/**
 * Who is signed in, and the calls that change it — the session (./session.ts), which holds every
 * rule about it, wired to React. Nothing else in the app touches the token.
 */
export type { AuthStatus } from './session.ts'

interface AuthValue {
  readonly status: AuthStatus
  readonly me: Me | null
  readonly signIn: (input: LoginInput) => Promise<void>
  readonly register: (input: RegisterInput) => Promise<void>
  readonly signOut: () => Promise<void>
  /** Saved to the account, so it follows them to every device — and to what the AI writes them. */
  readonly setWeightUnit: (unit: WeightUnit) => Promise<void>
  /** When unreachable: asks the server again about the token kept. */
  readonly retry: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth was called outside AuthProvider')
  return value
}

/**
 * Signed out — its rest alerts first, while the token still works, so the next person on this
 * device is not told this one's rests (#38). Best effort, as signing out is: it must never trap
 * someone signed in.
 */
async function signOut(): Promise<void> {
  await forgetThisDevice().catch(() => null)
  await session.signOut()
}

export function AuthProvider({
  children,
}: {
  readonly children: React.ReactNode
}): React.JSX.Element {
  const { status, me } = useSyncExternalStore(session.subscribe, session.snapshot)
  const queryClient = useQueryClient()

  useEffect(() => {
    void session.restore()
  }, [])
  useThisDeviceKept(status === 'signed-in')
  // Signed out — by choice or because the server stopped honouring the token: nothing cached for
  // the last person may be shown to the next.
  useEffect(
    () =>
      session.subscribe(() => {
        if (session.snapshot().status === 'signed-out') queryClient.clear()
      }),
    [queryClient],
  )

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
      signOut,
      setWeightUnit: session.setWeightUnit,
      retry: session.restore,
    }),
    [status, me],
  )

  return (
    <AuthContext.Provider value={value}>
      <WeightUnitProvider value={me?.user.weightUnit ?? 'kg'}>{children}</WeightUnitProvider>
    </AuthContext.Provider>
  )
}
