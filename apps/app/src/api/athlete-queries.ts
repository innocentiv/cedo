import { useCallback } from 'react'
import { type UseQueryResult, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Athlete,
  ExerciseHistory,
  Page,
  SessionDetail,
  TrainingReview,
  WorkoutSessionSummary,
} from '@cedo/contract'
import { api } from './http.ts'
import { useFinishedSessions } from './queries.ts'
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

/**
 * The athlete's training over the last `weeks`, reviewed as their own Progress reviews it. Asked
 * only while they share it (`shared`): once they stop, every read of theirs is a 404.
 */
export function useAthleteReview(
  id: string,
  weeks: number,
  shared: boolean,
): UseQueryResult<TrainingReview> {
  return useQuery({
    queryKey: keys.athleteReview(id, weeks),
    queryFn: async () => await api.athletes.review(id, { weeks }),
    enabled: shared,
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
export const useAthleteHistory = (id: string, shared: boolean) =>
  useFinishedSessions(
    (query) => keys.athleteSessions(id, query),
    async (query) => await api.athletes.sessions(id, query),
    shared,
  )

/**
 * Read again each time it is opened: they may be logging in it as the coach reads, and nothing the
 * coach does marks it stale. Never polled.
 */
export function useAthleteSession(id: string, sessionId: string): UseQueryResult<SessionDetail> {
  return useQuery({
    queryKey: keys.athleteSession(id, sessionId),
    queryFn: async () => await api.athletes.session(id, sessionId),
    enabled: id !== '' && sessionId !== '',
    staleTime: 0,
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

/**
 * Who shares with the reader, read again — then, while this athlete still does, everything read of
 * them — on coming back to their page (#30). They train on their own device, so no write here marks
 * it stale: a session finished while its sets were open was otherwise still "Training now" for the
 * cache's window, and a share switched off still listed. In that order, so a share ended is learnt
 * before their reads are asked again, and refused. Only what is shown refetches.
 */
export function useReadAthleteAgain(id: string): () => Promise<void> {
  const queryClient = useQueryClient()
  // The same function each render: the page reads again when it regains focus, not when it renders.
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: keys.athletes })
    const athletes = queryClient.getQueryData<Athlete[]>(keys.athletes) ?? []
    if (!athletes.some((athlete) => athlete.user.id === id)) return
    await Promise.all(
      [keys.athleteSessions(id, {}), keys.athleteReview(id, 0), keys.athleteEquipment(id)].map(
        async (key) => await queryClient.invalidateQueries({ queryKey: key.slice(0, 2) }),
      ),
    )
  }, [queryClient, id])
}
