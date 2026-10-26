import { type UseQueryResult, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type {
  Athlete,
  ExerciseHistory,
  Page,
  SessionDetail,
  TrainingReview,
  WorkoutSessionSummary,
} from '@cedo/contract'
import { api } from './http.ts'
import { keys } from './query-client.ts'

/**
 * What a coach reads of the athletes who share their training with them (#30) — reads only: a
 * coach changes nothing of an athlete's. Apart from queries.ts, as session-queries.ts is, because
 * every one of these is of somebody else. See docs/adr/0021-coaching-through-groups.md.
 */

/** Asked only while signed in: the shell asks it to know whether to offer the Athletes tab. */
export function useAthletes(enabled = true): UseQueryResult<Athlete[]> {
  return useQuery({
    queryKey: keys.athletes,
    queryFn: async () => await api.athletes.list(),
    enabled,
  })
}

/** The athlete's training over the last `weeks`, reviewed as their own Progress reviews it. */
export function useAthleteReview(id: string, weeks: number): UseQueryResult<TrainingReview> {
  return useQuery({
    queryKey: keys.athleteReview(id, weeks),
    queryFn: async () => await api.athletes.review(id, { weeks }),
    enabled: id !== '',
  })
}

/** Their session in progress, if there is one: at most one, so a page of one. */
export function useAthleteTrainingNow(id: string): UseQueryResult<Page<WorkoutSessionSummary>> {
  const query = { inProgress: true, limit: 1 }
  return useQuery({
    queryKey: keys.athleteSessions(id, query),
    queryFn: async () => await api.athletes.sessions(id, query),
    enabled: id !== '',
  })
}

/** Their finished sessions, newest first, a page at a time — as `useHistory` reads your own. */
export function useAthleteHistory(id: string) {
  return useInfiniteQuery({
    queryKey: keys.athleteSessions(id, { inProgress: false, pages: true }),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) =>
      await api.athletes.sessions(id, { inProgress: false, limit: 20, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last: Page<WorkoutSessionSummary>) => last.nextCursor ?? undefined,
    enabled: id !== '',
  })
}

export function useAthleteSession(id: string, sessionId: string): UseQueryResult<SessionDetail> {
  return useQuery({
    queryKey: keys.athleteSession(id, sessionId),
    queryFn: async () => await api.athletes.session(id, sessionId),
    enabled: id !== '' && sessionId !== '',
  })
}

export function useAthleteExerciseHistory(
  id: string,
  exerciseId: string,
): UseQueryResult<ExerciseHistory> {
  return useQuery({
    queryKey: keys.athleteHistory(id, exerciseId),
    queryFn: async () => await api.athletes.history(id, exerciseId, { limit: 10 }),
    enabled: id !== '' && exerciseId !== '',
  })
}
