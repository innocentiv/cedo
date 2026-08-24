import { z } from 'zod'
import {
  type DuplicateInput,
  Exercise,
  type ExerciseCreate,
  ExerciseHistory,
  type ExerciseHistoryQuery,
  type ExerciseQuery,
  type ExerciseUpdate,
  type GroupCreate,
  GroupMember,
  GroupMembership,
  Media,
  PersonalAccessToken,
  PersonalAccessTokenCreated,
  ProgressionSuggestion,
  type SessionQuery,
  type SessionStart,
  type SessionUpdate,
  SetLog,
  type LogSetInput,
  type TransferInput,
  Workout,
  type WorkoutCreate,
  type WorkoutPlanInput,
  type WorkoutQuery,
  WorkoutSession,
  WorkoutSessionSummary,
  WorkoutSummary,
  type WorkoutUpdate,
  page,
} from '@cedo/contract'
import { DELETE, GET, PATCH, POST, PUT, type QueryInput } from './http.ts'

/**
 * Every call the app can make, named after the route it hits and typed by the contract schema the
 * API validates against. Adding a method without a contract schema is not possible — the response
 * parser needs one, which is the point. See docs/adr/0015-no-eden-treaty.md.
 *
 * There is no `muscles` method: `MUSCLES` is a constant in `@cedo/contract`, so the picker needs no
 * request at all. The database copy exists only to give `exercise_muscles` a foreign key.
 */

/** Routes that answer `{ ok: true }` rather than the object they acted on. */
const Ok = z.object({ ok: z.boolean() })

/** Contract query types carry defaults and refinements; the wire wants plain scalars. */
const asQuery = (query: Record<string, unknown>): QueryInput =>
  Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean',
    ),
  )

export const api = {
  exercises: {
    list: async (query: Partial<ExerciseQuery> = {}) =>
      await GET('/exercises', page(Exercise), asQuery(query)),
    get: async (id: string) => await GET(`/exercises/${id}`, Exercise),
    create: async (body: ExerciseCreate) => await POST('/exercises', Exercise, body),
    update: async (id: string, body: ExerciseUpdate) =>
      await PATCH(`/exercises/${id}`, Exercise, body),
    remove: async (id: string) => await DELETE(`/exercises/${id}`, Ok),
    duplicate: async (id: string, body: DuplicateInput = {}) =>
      await POST(`/exercises/${id}/duplicate`, Exercise, body),
    transfer: async (id: string, body: TransferInput) =>
      await POST(`/exercises/${id}/transfer`, Exercise, body),
    favourite: async (id: string, on: boolean) =>
      on
        ? await PUT(`/exercises/${id}/favourite`, Ok, {})
        : await DELETE(`/exercises/${id}/favourite`, Ok),
    history: async (id: string, query: Partial<ExerciseHistoryQuery> = {}) =>
      await GET(`/exercises/${id}/history`, ExerciseHistory, asQuery(query)),
  },

  workouts: {
    list: async (query: Partial<WorkoutQuery> = {}) =>
      await GET('/workouts', page(WorkoutSummary), asQuery(query)),
    get: async (id: string) => await GET(`/workouts/${id}`, Workout),
    create: async (body: WorkoutCreate) => await POST('/workouts', Workout, body),
    update: async (id: string, body: WorkoutUpdate) =>
      await PATCH(`/workouts/${id}`, Workout, body),
    remove: async (id: string) => await DELETE(`/workouts/${id}`, Ok),
    replacePlan: async (id: string, body: WorkoutPlanInput) =>
      await PUT(`/workouts/${id}/plan`, Workout, body),
    progression: async (id: string) =>
      await GET(`/workouts/${id}/progression`, z.array(ProgressionSuggestion)),
    duplicate: async (id: string, body: DuplicateInput = {}) =>
      await POST(`/workouts/${id}/duplicate`, Workout, body),
    transfer: async (id: string, body: TransferInput) =>
      await POST(`/workouts/${id}/transfer`, Workout, body),
    favourite: async (id: string, on: boolean) =>
      on
        ? await PUT(`/workouts/${id}/favourite`, Ok, {})
        : await DELETE(`/workouts/${id}/favourite`, Ok),
  },

  sessions: {
    list: async (query: Partial<SessionQuery> = {}) =>
      await GET('/sessions', page(WorkoutSessionSummary), asQuery(query)),
    get: async (id: string) => await GET(`/sessions/${id}`, WorkoutSession),
    start: async (body: SessionStart) => await POST('/sessions', WorkoutSession, body),
    update: async (id: string, body: SessionUpdate) =>
      await PATCH(`/sessions/${id}`, WorkoutSession, body),
    logSet: async (id: string, body: LogSetInput) =>
      await POST(`/sessions/${id}/logs`, SetLog, body),
    removeLog: async (id: string, logId: string) =>
      await DELETE(`/sessions/${id}/logs/${logId}`, Ok),
  },

  groups: {
    list: async () => await GET('/groups', z.array(GroupMembership)),
    create: async (body: GroupCreate) => await POST('/groups', GroupMembership, body),
    members: async (id: string) => await GET(`/groups/${id}/members`, z.array(GroupMember)),
    addMember: async (id: string, body: { username: string; role: 'editor' | 'reader' }) =>
      await POST(`/groups/${id}/members`, GroupMember, body),
    removeMember: async (id: string, userId: string) =>
      await DELETE(`/groups/${id}/members/${userId}`, Ok),
  },

  media: {
    link: async (body: { url: string; title?: string }) => await POST('/media/link', Media, body),
  },

  tokens: {
    list: async () => await GET('/tokens', z.array(PersonalAccessToken)),
    create: async (body: { name: string }) =>
      await POST('/tokens', PersonalAccessTokenCreated, body),
    revoke: async (id: string) => await DELETE(`/tokens/${id}`, Ok),
  },
} as const
