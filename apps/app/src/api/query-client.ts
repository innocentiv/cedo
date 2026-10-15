import { QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './http.ts'

/**
 * One cache for the app. Query keys are `[resource, ...scope]`, so invalidating `['exercises']`
 * refreshes every list and detail of that resource. See docs/08-frontend.md.
 */
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

/** Query keys, in one place, so an invalidation cannot miss a list nobody remembered. */
export const keys = {
  muscles: ['muscles'] as const,
  exercises: ['exercises'] as const,
  exerciseList: (query: Record<string, unknown>) => ['exercises', 'list', query] as const,
  exercise: (id: string) => ['exercises', 'detail', id] as const,
  exerciseHistory: (id: string) => ['exercises', 'history', id] as const,
  workouts: ['workouts'] as const,
  workoutList: (query: Record<string, unknown>) => ['workouts', 'list', query] as const,
  workout: (id: string) => ['workouts', 'detail', id] as const,
  progression: (id: string) => ['workouts', 'progression', id] as const,
  sessions: ['sessions'] as const,
  sessionList: (query: Record<string, unknown>) => ['sessions', 'list', query] as const,
  session: (id: string) => ['sessions', 'detail', id] as const,
  groups: ['groups'] as const,
  tokens: ['tokens'] as const,
} as const
