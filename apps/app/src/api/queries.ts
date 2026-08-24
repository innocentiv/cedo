import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  Exercise,
  ExerciseCreate,
  ExerciseHistory,
  ExerciseQuery,
  ExerciseUpdate,
  GroupMembership,
  LogSetInput,
  Page,
  PersonalAccessToken,
  ProgressionSuggestion,
  SessionQuery,
  SessionStart,
  SessionUpdate,
  SetLog,
  Workout,
  WorkoutCreate,
  WorkoutPlanInput,
  WorkoutQuery,
  WorkoutSession,
  WorkoutSessionSummary,
  WorkoutSummary,
} from '@cedo/contract'
import { api } from './client.ts'
import { keys } from './query-client.ts'

/**
 * Every read and write a screen may perform, as hooks.
 *
 * Screens do not call `api.*` directly and do not build query keys, so an invalidation cannot miss
 * a list somebody forgot about — `keys` in `query-client.ts` is the only place they are written.
 * See docs/08-frontend.md.
 */

export function useExercises(query: Partial<ExerciseQuery>): UseQueryResult<Page<Exercise>> {
  return useQuery({
    queryKey: keys.exerciseList(query),
    queryFn: async () => await api.exercises.list(query),
  })
}

export function useExercise(id: string): UseQueryResult<Exercise> {
  return useQuery({
    queryKey: keys.exercise(id),
    queryFn: async () => await api.exercises.get(id),
    enabled: id !== '',
  })
}

export function useExerciseHistory(id: string): UseQueryResult<ExerciseHistory> {
  return useQuery({
    queryKey: keys.exerciseHistory(id),
    queryFn: async () => await api.exercises.history(id, { limit: 10 }),
    enabled: id !== '',
  })
}

export function useWorkouts(query: Partial<WorkoutQuery>): UseQueryResult<Page<WorkoutSummary>> {
  return useQuery({
    queryKey: keys.workoutList(query),
    queryFn: async () => await api.workouts.list(query),
  })
}

export function useWorkout(id: string): UseQueryResult<Workout> {
  return useQuery({
    queryKey: keys.workout(id),
    queryFn: async () => await api.workouts.get(id),
    enabled: id !== '',
  })
}

export function useProgression(id: string): UseQueryResult<ProgressionSuggestion[]> {
  return useQuery({
    queryKey: keys.progression(id),
    queryFn: async () => await api.workouts.progression(id),
    enabled: id !== '',
  })
}

export function useSessions(
  query: Partial<SessionQuery> = {},
): UseQueryResult<Page<WorkoutSessionSummary>> {
  return useQuery({
    queryKey: keys.sessionList(query),
    queryFn: async () => await api.sessions.list(query),
  })
}

export function useSession(id: string): UseQueryResult<WorkoutSession> {
  return useQuery({
    queryKey: keys.session(id),
    queryFn: async () => await api.sessions.get(id),
    enabled: id !== '',
  })
}

export function useGroups(): UseQueryResult<GroupMembership[]> {
  return useQuery({ queryKey: keys.groups, queryFn: async () => await api.groups.list() })
}

export function useTokens(): UseQueryResult<PersonalAccessToken[]> {
  return useQuery({ queryKey: keys.tokens, queryFn: async () => await api.tokens.list() })
}

/**
 * Mutations invalidate the whole resource, not one key.
 *
 * Creating an exercise changes the `all` list, the `mine` list, every filtered list and the group
 * it landed in. Enumerating those is how a stale screen happens; invalidating `['exercises']`
 * refetches only what is currently mounted anyway.
 */
function useResourceMutation<TInput, TResult>(
  resource: readonly string[],
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: resource })
    },
  })
}

export const useCreateExercise = () =>
  useResourceMutation(
    keys.exercises,
    async (input: ExerciseCreate) => await api.exercises.create(input),
  )

export const useUpdateExercise = (id: string) =>
  useResourceMutation(
    keys.exercises,
    async (input: ExerciseUpdate) => await api.exercises.update(id, input),
  )

export const useDeleteExercise = () =>
  useResourceMutation(keys.exercises, async (id: string) => await api.exercises.remove(id))

export const useFavouriteExercise = () =>
  useResourceMutation(
    keys.exercises,
    async (input: { id: string; on: boolean }) => await api.exercises.favourite(input.id, input.on),
  )

export const useDuplicateExercise = () =>
  useResourceMutation(keys.exercises, async (id: string) => await api.exercises.duplicate(id))

export const useCreateWorkout = () =>
  useResourceMutation(
    keys.workouts,
    async (input: WorkoutCreate) => await api.workouts.create(input),
  )

export const useReplacePlan = (id: string) =>
  useResourceMutation(
    keys.workouts,
    async (input: WorkoutPlanInput) => await api.workouts.replacePlan(id, input),
  )

export const useDeleteWorkout = () =>
  useResourceMutation(keys.workouts, async (id: string) => await api.workouts.remove(id))

export const useFavouriteWorkout = () =>
  useResourceMutation(
    keys.workouts,
    async (input: { id: string; on: boolean }) => await api.workouts.favourite(input.id, input.on),
  )

export const useStartSession = () =>
  useResourceMutation(keys.sessions, async (input: SessionStart) => await api.sessions.start(input))

export const useUpdateSession = (id: string) =>
  useResourceMutation(
    keys.sessions,
    async (input: SessionUpdate) => await api.sessions.update(id, input),
  )

export const useLogSet = (sessionId: string) =>
  useResourceMutation(
    keys.sessions,
    async (input: LogSetInput): Promise<SetLog> => await api.sessions.logSet(sessionId, input),
  )

export const useRemoveLog = (sessionId: string) =>
  useResourceMutation(
    keys.sessions,
    async (logId: string) => await api.sessions.removeLog(sessionId, logId),
  )

export const useCreateToken = () =>
  useResourceMutation(
    keys.tokens,
    async (input: { name: string }) => await api.tokens.create(input),
  )

export const useRevokeToken = () =>
  useResourceMutation(keys.tokens, async (id: string) => await api.tokens.revoke(id))

export const useCreateMediaLink = () =>
  useResourceMutation(
    keys.exercises,
    async (input: { url: string; title?: string }) => await api.media.link(input),
  )
