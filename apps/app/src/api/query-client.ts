import { QueryCache, QueryClient } from '@tanstack/react-query'
import type { Read } from '@cedo/contract'
import { ApiError } from './http.ts'

/** One cache for the app. See docs/08-frontend.md. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    /**
     * Every failed READ reaches `console.error`. A screen renders one as an inline notice, and
     * TanStack Query logs nothing itself, so a `ContractDriftError` or a 500 on a GET was invisible
     * to the e2e harness — which fails a run on console errors and nothing else. The route sweep
     * passed over screens whose every request was failing. `e2e/harness.e2e.ts` pins this.
     *
     * A 401 is the one exception: the auth layer answers it by signing out, which is the designed
     * response to a revoked token, not a fault.
     */
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (error instanceof ApiError && error.status === 401) return
        console.error(`[query ${JSON.stringify(query.queryKey)}]`, error.message)
      },
    }),
    defaultOptions: {
      queries: {
        /**
         * A self-hosted instance is used by a handful of people and its data barely moves during a
         * session, but a workout is logged set by set — so the window is short, not long.
         */
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Retrying a 404 or a validation failure just delays the error the user needs to see.
          if (error instanceof ApiError && error.status < 500) return false
          return failureCount < 2
        },
      },
      mutations: { retry: false },
    },
  })
}

/** A read's key starts with the read's own name — `[read]` is what a write refreshes. */
type KeyOf<R extends Read> = readonly [R, ...unknown[]]

/**
 * One query key per read in the contract's `READS`: `[read, ...args]`, so `[read]` is the prefix
 * that refreshes every copy of it.
 *
 * Flat on purpose. Progression used to live under `['workouts', …]` and history under
 * `['exercises', …]`, so each was refreshed with its parent by accident — a dependency that worked
 * without being written down anywhere. What a write makes stale is `affectedBy` in the contract,
 * and nothing else. See docs/08-frontend.md.
 */
export const keys = {
  exerciseList: (query: Record<string, unknown>) => ['exerciseList', query] as const,
  exercise: (id: string) => ['exercise', id] as const,
  exerciseHistory: (id: string) => ['exerciseHistory', id] as const,
  workoutList: (query: Record<string, unknown>) => ['workoutList', query] as const,
  workout: (id: string) => ['workout', id] as const,
  progression: (id: string) => ['progression', id] as const,
  sessionList: (query: Record<string, unknown>) => ['sessionList', query] as const,
  session: (id: string) => ['session', id] as const,
  sessionTargets: (sessionId: string) => ['sessionTargets', sessionId] as const,
  today: (weekStart: string) => ['today', weekStart] as const,
  groups: ['groups'] as const,
  groupMembers: (id: string) => ['groupMembers', id] as const,
  tokens: ['tokens'] as const,
} as const satisfies { readonly [R in Read]: KeyOf<R> | ((...args: never[]) => KeyOf<R>) }
