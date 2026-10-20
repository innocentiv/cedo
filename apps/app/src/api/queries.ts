import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  Exercise,
  ExerciseInput,
  ExerciseHistory,
  ExerciseQuery,
  ExerciseUpdate,
  GroupMembership,
  LogSetInput,
  Media,
  Page,
  PersonalAccessToken,
  PersonalAccessTokenCreate,
  ProgressionSuggestion,
  Source,
  SessionQuery,
  SessionStart,
  SessionUpdate,
  SetLog,
  Workout,
  WorkoutCreate,
  WorkoutPlanInput,
  WorkoutQuery,
  SessionDetail,
  WorkoutSessionSummary,
  WorkoutSummary,
} from '@cedo/contract'
import { type Read, affectedBy } from '@cedo/contract'
import { ApiError } from './errors.ts'
import { api } from './http.ts'
import { keys } from './query-client.ts'

/**
 * Every read and write a screen may perform, as hooks.
 *
 * Screens do not call `api.*` directly and do not build query keys. A write names the one source
 * it changes, and what that makes stale is derived from what each read declares it is built from —
 * `READS` in the contract. See docs/08-frontend.md.
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

export function useSession(id: string): UseQueryResult<SessionDetail> {
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
 * A write to `source` refreshes every read it makes stale (`affectedBy`): all copies of each,
 * whatever their arguments, since only what is mounted actually refetches. The reads OF the
 * source are awaited, because the next write reads them — the live session numbers the next set
 * from the refreshed logs. Reads that only embed it are marked stale at once and refetch behind.
 *
 * A refused write — gone, out of reach, or a conflict with what is stored — reads again what it
 * was OF, and nothing more: someone else's write may have moved the screen's picture on, and it is
 * a cheap re-read when it has not. See docs/08-frontend.md.
 *
 * Nothing reports a failure here — there is deliberately no `onError` that logs or swallows one.
 * A blanket handler cannot tell a failure nobody is watching from one a form is already showing —
 * it logged every rejected validation, including the ones `useSubmit` renders, and turned an
 * expected 422 into a failed e2e run. The rule instead: **every caller awaits `mutateAsync` inside
 * `submit()`**, so the message reaches `FormError` and, when it is not an `ApiError`, the console.
 * A bare `.mutate()` is the smell — it reads nothing back.
 */
function useWriteTo<TInput, TResult>(
  source: Source,
  run: (input: TInput) => Promise<TResult>,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient()
  const reread = async (reads: readonly Read[]): Promise<void> => {
    await Promise.all(
      reads.map(async (read) => queryClient.invalidateQueries({ queryKey: [read] })),
    )
  }
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      const { awaited, background } = affectedBy(source)
      for (const read of background) void queryClient.invalidateQueries({ queryKey: [read] })
      await reread(awaited)
    },
    // Not awaited: the refusal reaches the form at once, and the re-read follows it.
    onError: (error) => {
      if (error instanceof ApiError && (error.code === 'not_found' || error.code === 'conflict')) {
        void reread(affectedBy(source).awaited)
      }
    },
  })
}

export const useCreateExercise = () =>
  useWriteTo('exercise', async (input: ExerciseInput) => await api.exercises.create(input))

export const useUpdateExercise = (id: string) =>
  useWriteTo('exercise', async (input: ExerciseUpdate) => await api.exercises.update(id, input))

export const useDeleteExercise = () =>
  useWriteTo('exercise', async (id: string) => await api.exercises.remove(id))

export const useFavouriteExercise = () =>
  useWriteTo(
    'exercise',
    async (input: { id: string; on: boolean }) => await api.exercises.favourite(input.id, input.on),
  )

export const useDuplicateExercise = () =>
  useWriteTo('exercise', async (id: string) => await api.exercises.duplicate(id))

export const useCreateWorkout = () =>
  useWriteTo('workout', async (input: WorkoutCreate) => await api.workouts.create(input))

export const useReplacePlan = (id: string) =>
  useWriteTo(
    'workout',
    async (input: WorkoutPlanInput) => await api.workouts.replacePlan(id, input),
  )

export const useDeleteWorkout = () =>
  useWriteTo('workout', async (id: string) => await api.workouts.remove(id))

export const useFavouriteWorkout = () =>
  useWriteTo(
    'workout',
    async (input: { id: string; on: boolean }) => await api.workouts.favourite(input.id, input.on),
  )

export const useStartSession = () =>
  useWriteTo('session', async (input: SessionStart) => await api.sessions.start(input))

export const useUpdateSession = (id: string) =>
  useWriteTo('session', async (input: SessionUpdate) => await api.sessions.update(id, input))

export const useLogSet = (sessionId: string) =>
  useWriteTo(
    'session',
    async (input: LogSetInput): Promise<SetLog> => await api.sessions.logSet(sessionId, input),
  )

export const useRemoveLog = (sessionId: string) =>
  useWriteTo('session', async (logId: string) => await api.sessions.removeLog(sessionId, logId))

export const useCreateToken = () =>
  useWriteTo('token', async (input: PersonalAccessTokenCreate) => await api.tokens.create(input))

export const useRevokeToken = () =>
  useWriteTo('token', async (id: string) => await api.tokens.revoke(id))

/**
 * Makes nothing stale, so it refreshes nothing: a link is an exercise's media only once the
 * exercise is saved with it, and that save is the exercise write. The form keeps the result itself.
 */
export const useCreateMediaLink = (): UseMutationResult<
  Media,
  Error,
  { url: string; title?: string }
> => useMutation({ mutationFn: async (input) => await api.media.link(input) })
