import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  EntryTarget,
  Exercise,
  ExerciseInput,
  ExerciseHistory,
  ExerciseQuery,
  ExerciseUpdate,
  GroupAddMember,
  GroupCreate,
  GroupMember,
  GroupMembership,
  LogSetInput,
  Media,
  Page,
  PersonalAccessToken,
  PersonalAccessTokenCreate,
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
import { type Read, affectedBy, mcpAddress } from '@cedo/contract'
import { ApiError } from './errors.ts'
import { api, apiRoot } from './http.ts'
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

/**
 * What a session asks of each entry of its day — the logger's pre-fill — and last time's sets.
 * Asked for only when there is a day to show: `enabled` false otherwise.
 */
export function useSessionTargets(
  sessionId: string,
  enabled: boolean,
): UseQueryResult<EntryTarget[]> {
  return useQuery({
    queryKey: keys.sessionTargets(sessionId),
    queryFn: async () => await api.sessions.targets(sessionId),
    enabled: enabled && sessionId !== '',
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

export function useGroupMembers(id: string): UseQueryResult<GroupMember[]> {
  return useQuery({
    queryKey: keys.groupMembers(id),
    queryFn: async () => await api.groups.members(id),
    enabled: id !== '',
  })
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
  deletes?: (input: TInput) => string,
): UseMutationResult<TResult, Error, TInput> {
  const queryClient = useQueryClient()
  /**
   * Every cached read of `reads` — but none keyed by what the write deletes. `[read, id]` is the
   * thing itself: just deleted, or already gone (404), it is not asked for again by the screen
   * still showing it, which would be told it does not exist and say so on the console. Derived from
   * the key shape, not listed per delete, so a new read keyed by the id is skipped without being
   * remembered. Left to be collected once nothing shows it.
   */
  const refresh = async (reads: readonly Read[], deleted: string | undefined) => {
    await Promise.all(
      reads.map(async (read) =>
        queryClient.invalidateQueries({
          queryKey: [read],
          predicate: (query) => deleted === undefined || query.queryKey[1] !== deleted,
        }),
      ),
    )
  }
  return useMutation({
    mutationFn: run,
    onSuccess: async (_result, input) => {
      const deleted = deletes?.(input)
      const { awaited, background } = affectedBy(source)
      void refresh(background, deleted)
      await refresh(awaited, deleted)
    },
    // Not awaited: the refusal reaches the form at once, and the re-read follows it.
    onError: (error, input) => {
      if (error instanceof ApiError && (error.code === 'not_found' || error.code === 'conflict')) {
        void refresh(affectedBy(source).awaited, deletes?.(input))
      }
    },
  })
}

/** A delete of `source` by id: the reads keyed by that id are not refreshed — see `useWriteTo`. */
const useDeleteOf = (source: Source, remove: (id: string) => Promise<unknown>) =>
  useWriteTo(source, remove, (id: string) => id)

export const useCreateExercise = () =>
  useWriteTo('exercise', async (input: ExerciseInput) => await api.exercises.create(input))

export const useUpdateExercise = (id: string) =>
  useWriteTo('exercise', async (input: ExerciseUpdate) => await api.exercises.update(id, input))

export const useDeleteExercise = () =>
  useDeleteOf('exercise', async (id) => await api.exercises.remove(id))

export const useFavouriteExercise = () =>
  useWriteTo(
    'exercise',
    async (input: { id: string; on: boolean }) => await api.exercises.favourite(input.id, input.on),
  )

/** Into another group you edit. The exercise is still yours to see, so nothing is skipped. */
export const useTransferExercise = () =>
  useWriteTo(
    'exercise',
    async (input: { id: string; toGroupId: string }) =>
      await api.exercises.transfer(input.id, { toGroupId: input.toGroupId }),
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
  useDeleteOf('workout', async (id) => await api.workouts.remove(id))

export const useTransferWorkout = () =>
  useWriteTo(
    'workout',
    async (input: { id: string; toGroupId: string }) =>
      await api.workouts.transfer(input.id, { toGroupId: input.toGroupId }),
  )

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

/** This instance's MCP address, as an AI's client must be told it. Not a read: nothing to fetch. */
export const useMcpAddress = (): string => mcpAddress(apiRoot())

export const useCreateToken = () =>
  useWriteTo('token', async (input: PersonalAccessTokenCreate) => await api.tokens.create(input))

export const useRevokeToken = () =>
  useWriteTo('token', async (id: string) => await api.tokens.revoke(id))

export const useCreateGroup = () =>
  useWriteTo('group', async (input: GroupCreate) => await api.groups.create(input))

export const useAddMember = (groupId: string) =>
  useWriteTo('group', async (input: GroupAddMember) => await api.groups.addMember(groupId, input))

export const useRemoveMember = (groupId: string) =>
  useWriteTo('group', async (userId: string) => await api.groups.removeMember(groupId, userId))

/**
 * Removing yourself: what the group showed you is yours to read no more, its members included —
 * so, like a delete, they are not asked for again by the screen still showing them.
 */
export const useLeaveGroup = (myUserId: string) =>
  useDeleteOf('group', async (groupId) => await api.groups.removeMember(groupId, myUserId))

/**
 * Makes nothing stale, so it refreshes nothing: a link is an exercise's media only once the
 * exercise is saved with it, and that save is the exercise write. The form keeps the result itself.
 */
export const useCreateMediaLink = (): UseMutationResult<
  Media,
  Error,
  { url: string; title?: string }
> => useMutation({ mutationFn: async (input) => await api.media.link(input) })
