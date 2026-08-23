import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { AuthResult, type LoginInput, Me, type RegisterInput } from '@cedo/contract'
import { ApiError, GET, POST, setAuthToken } from '../api/http.ts'
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
      const stored = await readToken()
      if (cancelled) return
      if (stored === null) {
        setStatus('signed-out')
        return
      }
      setAuthToken(stored)
      try {
        const identity = await GET('/auth/me', Me)
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

export function AuthProvider({
  children,
}: {
  readonly children: React.ReactNode
}): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const queryClient = useQueryClient()

  const adopt = useCallback(async (token: string) => {
    setAuthToken(token)
    await writeToken(token)
    const identity = await GET('/auth/me', Me)
    setMe(identity)
    setStatus('signed-in')
  }, [])

  const signOut = useCallback(async () => {
    // Best effort: the local session ends either way, and a network failure must not trap someone
    // in a signed-in shell they cannot use.
    await POST('/auth/logout', z.object({ ok: z.boolean() })).catch(() => null)
    setAuthToken(null)
    await clearToken()
    setMe(null)
    setStatus('signed-out')
    queryClient.clear()
  }, [queryClient])

  useRestoreSession({ setStatus, setMe })

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      signIn: async (input) => {
        await adopt((await POST('/auth/login', AuthResult, input)).token)
      },
      register: async (input) => {
        await adopt((await POST('/auth/register', AuthResult, input)).token)
      },
      signOut,
    }),
    [status, me, adopt, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
