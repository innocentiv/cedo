import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import type { LoginInput, Me, RegisterInput, WeightUnit } from '@cedo/contract'
import { ApiError, api, setAuthToken, setUnauthenticatedHandler } from '../api/http.ts'
import { WeightUnitProvider } from '../lib/weight-unit.ts'
import { clearToken, readToken, writeToken } from './token-storage.ts'

/**
 * Who is signed in, and the two calls that change it. Nothing else in the app touches the token.
 *
 * `status` is a three-state, not a boolean: on first paint the stored token has not been read yet,
 * and a router that treats "unknown" as "signed out" bounces a returning user to the login screen
 * for one frame before bouncing them back. See docs/08-frontend.md.
 */
export type AuthStatus = 'loading' | 'signed-in' | 'signed-out'

interface AuthValue {
  readonly status: AuthStatus
  readonly me: Me | null
  readonly signIn: (input: LoginInput) => Promise<void>
  readonly register: (input: RegisterInput) => Promise<void>
  readonly signOut: () => Promise<void>
  /** Saved to the account, so it follows them to every device — and to what the AI writes them. */
  readonly setWeightUnit: (unit: WeightUnit) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth was called outside AuthProvider')
  return value
}

/**
 * Restores a stored session once, at startup.
 *
 * An expired or revoked token is the ordinary case, not an error worth showing — a self-hosted
 * instance is often reopened weeks later — so it is cleared quietly and only unexpected failures
 * reach the console.
 */
function useRestoreSession(set: {
  readonly setStatus: (status: AuthStatus) => void
  readonly setMe: (me: Me | null) => void
}): void {
  const { setStatus, setMe } = set
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // A keychain that throws (native) must not strand the app on the boot spinner forever.
      const stored = await readToken().catch((error: unknown) => {
        console.error(error)
        return null
      })
      if (cancelled) return
      if (stored === null) {
        setStatus('signed-out')
        return
      }
      setAuthToken(stored)
      try {
        const identity = await api.auth.me()
        if (cancelled) return
        setMe(identity)
        setStatus('signed-in')
      } catch (error) {
        if (cancelled) return
        if (!(error instanceof ApiError) || error.code !== 'unauthenticated') console.error(error)
        setAuthToken(null)
        await clearToken()
        setStatus('signed-out')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setStatus, setMe])
}

/**
 * A credential the server no longer honours ends the local session too, rather than leaving every
 * screen showing "Authentication required" with no way back to the login form.
 */
function useSignOutOnRejection(forget: () => void, queryClient: QueryClient): void {
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      forget()
      queryClient.clear()
    })
    return () => {
      setUnauthenticatedHandler(null)
    }
  }, [forget, queryClient])
}

/**
 * The session itself: who is signed in, and the two operations that change it.
 *
 * Separated from the provider so `AuthProvider` is only wiring. `adopt` is shared by sign-in and
 * registration, which differ solely in which route mints the token.
 */
function useSessionState(): {
  status: AuthStatus
  me: Me | null
  adopt: (token: string) => Promise<void>
  signOut: () => Promise<void>
  setWeightUnit: (unit: WeightUnit) => Promise<void>
} {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const queryClient = useQueryClient()

  const adopt = useCallback(async (token: string) => {
    setAuthToken(token)
    await writeToken(token)
    setMe(await api.auth.me())
    setStatus('signed-in')
  }, [])

  /** Drops the local session. Shared by an explicit sign-out and a credential the server rejects. */
  const forget = useCallback(() => {
    setAuthToken(null)
    void clearToken()
    setMe(null)
    setStatus('signed-out')
  }, [])

  const signOut = useCallback(async () => {
    // Best effort: the local session ends either way, and a network failure must not trap someone
    // in a signed-in shell they cannot use.
    await api.auth.logout().catch(() => null)
    forget()
    queryClient.clear()
  }, [forget, queryClient])

  const setWeightUnit = useCallback(async (weightUnit: WeightUnit) => {
    setMe(await api.auth.updateMe({ weightUnit }))
  }, [])

  useRestoreSession({ setStatus, setMe })
  useSignOutOnRejection(forget, queryClient)

  return { status, me, adopt, signOut, setWeightUnit }
}

export function AuthProvider({
  children,
}: {
  readonly children: React.ReactNode
}): React.JSX.Element {
  const { status, me, adopt, signOut, setWeightUnit } = useSessionState()

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      signIn: async (input) => {
        await adopt((await api.auth.login(input)).token)
      },
      register: async (input) => {
        await adopt((await api.auth.register(input)).token)
      },
      signOut,
      setWeightUnit,
    }),
    [status, me, adopt, signOut, setWeightUnit],
  )

  return (
    <AuthContext.Provider value={value}>
      <WeightUnitProvider value={me?.user.weightUnit ?? 'kg'}>{children}</WeightUnitProvider>
    </AuthContext.Provider>
  )
}
