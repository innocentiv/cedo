import { z } from 'zod'
import {
  AuthResult,
  type DuplicateInput,
  Exercise,
  type ExerciseCreate,
  ExerciseHistory,
  type ExerciseHistoryQuery,
  type ExerciseQuery,
  type ExerciseUpdate,
  type GroupAddMember,
  type GroupCreate,
  type LoginInput,
  Me,
  type MeUpdate,
  type RegisterInput,
  GroupMember,
  GroupMembership,
  Media,
  PersonalAccessToken,
  type PersonalAccessTokenCreate,
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
import type { QueryInput, SendRequest } from './transport.ts'

/**
 * Every call the app can make, named after the route it hits and typed by the contract schema the
 * API validates against. Adding a method without a contract schema is not possible — the response
 * parser needs one, which is the point. See docs/adr/0015-no-eden-treaty.md.
 *
 * Built over a `SendRequest` rather than holding one, so the same table serves two adapters: the app's
 * own session (`api` in `http.ts`), and the e2e harness acting as any user it signs up — from the
 * test process, every response parsed, instead of untyped `fetch`es evaluated in the page.
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

/** The five verbs, over one `Request`. */
function verbs(request: SendRequest) {
  return {
    GET: async <S extends z.ZodType>(path: string, schema: S, query?: QueryInput) =>
      await request('GET', path, schema, { ...(query && { query }) }),
    POST: async <S extends z.ZodType>(path: string, schema: S, body?: unknown) =>
      await request('POST', path, schema, { body }),
    PATCH: async <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
      await request('PATCH', path, schema, { body }),
    PUT: async <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
      await request('PUT', path, schema, { body }),
    DELETE: async <S extends z.ZodType>(path: string, schema: S) =>
      await request('DELETE', path, schema),
  }
}

type Verbs = ReturnType<typeof verbs>

const auth = ({ GET, POST, PATCH }: Verbs) => ({
  register: async (body: RegisterInput) => await POST('/auth/register', AuthResult, body),
  login: async (body: LoginInput) => await POST('/auth/login', AuthResult, body),
  logout: async () => await POST('/auth/logout', Ok),
  me: async () => await GET('/auth/me', Me),
  updateMe: async (body: MeUpdate) => await PATCH('/auth/me', Me, body),
})

const exercises = ({ GET, POST, PATCH, PUT, DELETE }: Verbs) => ({
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
})

const workouts = ({ GET, POST, PATCH, PUT, DELETE }: Verbs) => ({
  list: async (query: Partial<WorkoutQuery> = {}) =>
    await GET('/workouts', page(WorkoutSummary), asQuery(query)),
  get: async (id: string) => await GET(`/workouts/${id}`, Workout),
  create: async (body: WorkoutCreate) => await POST('/workouts', Workout, body),
  update: async (id: string, body: WorkoutUpdate) => await PATCH(`/workouts/${id}`, Workout, body),
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
})

const sessions = ({ GET, POST, PATCH, DELETE }: Verbs) => ({
  list: async (query: Partial<SessionQuery> = {}) =>
    await GET('/sessions', page(WorkoutSessionSummary), asQuery(query)),
  get: async (id: string) => await GET(`/sessions/${id}`, WorkoutSession),
  start: async (body: SessionStart) => await POST('/sessions', WorkoutSession, body),
  update: async (id: string, body: SessionUpdate) =>
    await PATCH(`/sessions/${id}`, WorkoutSession, body),
  logSet: async (id: string, body: LogSetInput) => await POST(`/sessions/${id}/logs`, SetLog, body),
  removeLog: async (id: string, logId: string) => await DELETE(`/sessions/${id}/logs/${logId}`, Ok),
})

const groups = ({ GET, POST, DELETE }: Verbs) => ({
  list: async () => await GET('/groups', z.array(GroupMembership)),
  create: async (body: GroupCreate) => await POST('/groups', GroupMembership, body),
  members: async (id: string) => await GET(`/groups/${id}/members`, z.array(GroupMember)),
  addMember: async (id: string, body: GroupAddMember) =>
    await POST(`/groups/${id}/members`, GroupMember, body),
  removeMember: async (id: string, userId: string) =>
    await DELETE(`/groups/${id}/members/${userId}`, Ok),
})

const media = ({ POST }: Verbs) => ({
  link: async (body: { url: string; title?: string }) => await POST('/media/link', Media, body),
})

const tokens = ({ GET, POST, DELETE }: Verbs) => ({
  list: async () => await GET('/tokens', z.array(PersonalAccessToken)),
  create: async (body: PersonalAccessTokenCreate) =>
    await POST('/tokens', PersonalAccessTokenCreated, body),
  revoke: async (id: string) => await DELETE(`/tokens/${id}`, Ok),
})

export function createApi(request: SendRequest) {
  const v = verbs(request)
  return {
    auth: auth(v),
    exercises: exercises(v),
    workouts: workouts(v),
    sessions: sessions(v),
    groups: groups(v),
    media: media(v),
    tokens: tokens(v),
  } as const
}

export type ApiClient = ReturnType<typeof createApi>
