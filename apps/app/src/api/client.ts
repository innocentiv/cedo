import { z } from 'zod'
import {
  Athlete,
  AthleteEquipment,
  type AthleteEquipmentInput,
  AuthResult,
  type DuplicateInput,
  EntryTarget,
  Exercise,
  type ExerciseCreateRequestInput,
  ExerciseHistory,
  type ExerciseHistoryQuery,
  type ExerciseQuery,
  type ExerciseUpdate,
  type GroupAddMember,
  type GroupCreate,
  type GroupMembershipPatch,
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
  SessionDetail,
  type SessionQuery,
  Today,
  type TodayQuery,
  type ReviewQuery,
  TrainingReview,
  type SessionStart,
  type SessionUpdate,
  type SetLogUpdate,
  SetLog,
  IDEMPOTENCY_KEY_HEADER,
  type LogSetInput,
  type TransferInput,
  Workout,
  type WorkoutCreate,
  type PlanSave,
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

/** The five HTTP verbs and a multipart upload, over one `Request`. */
function verbs(request: SendRequest) {
  return {
    GET: async <S extends z.ZodType>(path: string, schema: S, query?: QueryInput) =>
      await request('GET', path, schema, { ...(query && { query }) }),
    POST: async <S extends z.ZodType>(
      path: string,
      schema: S,
      body?: unknown,
      headers?: Readonly<Record<string, string>>,
    ) => await request('POST', path, schema, { body, ...(headers && { headers }) }),
    PATCH: async <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
      await request('PATCH', path, schema, { body }),
    PUT: async <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
      await request('PUT', path, schema, { body }),
    DELETE: async <S extends z.ZodType>(path: string, schema: S) =>
      await request('DELETE', path, schema),
    /** A multipart POST: the form sets its own content type, boundary included. */
    UPLOAD: async <S extends z.ZodType>(path: string, schema: S, form: FormData) =>
      await request('POST', path, schema, { form }),
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
  create: async (body: ExerciseCreateRequestInput) => await POST('/exercises', Exercise, body),
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
  /** What a picker leads with (#27): those logged most lately, latest first. */
  recent: async () => await GET('/exercises/recent', z.array(Exercise), { limit: '5' }),
})

const workouts = ({ GET, POST, PATCH, PUT, DELETE }: Verbs) => ({
  list: async (query: Partial<WorkoutQuery> = {}) =>
    await GET('/workouts', page(WorkoutSummary), asQuery(query)),
  get: async (id: string) => await GET(`/workouts/${id}`, Workout),
  create: async (body: WorkoutCreate) => await POST('/workouts', Workout, body),
  update: async (id: string, body: WorkoutUpdate) => await PATCH(`/workouts/${id}`, Workout, body),
  remove: async (id: string) => await DELETE(`/workouts/${id}`, Ok),
  replacePlan: async (id: string, body: PlanSave) =>
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
  get: async (id: string) => await GET(`/sessions/${id}`, SessionDetail),
  targets: async (id: string) => await GET(`/sessions/${id}/targets`, z.array(EntryTarget)),
  start: async (body: SessionStart) => await POST('/sessions', WorkoutSession, body),
  update: async (id: string, body: SessionUpdate) =>
    await PATCH(`/sessions/${id}`, WorkoutSession, body),
  /** `idempotencyKey`, made once per set, makes a retry of it safe — see `IDEMPOTENCY_KEY_HEADER`. */
  logSet: async (id: string, body: LogSetInput, idempotencyKey?: string) =>
    await POST(
      `/sessions/${id}/logs`,
      SetLog,
      body,
      idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    ),
  /** A session and its sets, in progress or finished (#31). */
  remove: async (id: string) => await DELETE(`/sessions/${id}`, Ok),
  removeLog: async (id: string, logId: string) => await DELETE(`/sessions/${id}/logs/${logId}`, Ok),
  /** A set corrected: its reserve said after it (#24), or a past mistake fixed (#31). */
  amendLog: async (id: string, logId: string, body: SetLogUpdate) =>
    await PATCH(`/sessions/${id}/logs/${logId}`, SetLog, body),
})

/** What to do next (#25): the session in progress, the next day, this week. */
const today = ({ GET }: Verbs) => ({
  get: async (query: TodayQuery) => await GET('/today', Today, asQuery(query)),
})

/** Your training, reviewed (#28): the Progress tab. */
const review = ({ GET }: Verbs) => ({
  get: async (query: ReviewQuery) => await GET('/review', TrainingReview, asQuery(query)),
})

/** An athlete's training, read by their coach (#30): GET only — a coach changes none of it. */
const athletes = ({ GET }: Verbs) => ({
  list: async () => await GET('/athletes', z.array(Athlete)),
  sessions: async (id: string, query: Partial<SessionQuery> = {}) =>
    await GET(`/athletes/${id}/sessions`, page(WorkoutSessionSummary), asQuery(query)),
  session: async (id: string, sessionId: string) =>
    await GET(`/athletes/${id}/sessions/${sessionId}`, SessionDetail),
  history: async (id: string, exerciseId: string, query: Partial<ExerciseHistoryQuery> = {}) =>
    await GET(`/athletes/${id}/exercises/${exerciseId}/history`, ExerciseHistory, asQuery(query)),
  review: async (id: string, query: ReviewQuery) =>
    await GET(`/athletes/${id}/review`, TrainingReview, asQuery(query)),
  equipment: async (id: string) => await GET(`/athletes/${id}/equipment`, AthleteEquipment),
})

/** What you have to train with (#34), replaced whole. */
const equipment = ({ GET, PUT }: Verbs) => ({
  get: async () => await GET('/equipment', AthleteEquipment),
  save: async (body: AthleteEquipmentInput) => await PUT('/equipment', AthleteEquipment, body),
})

const groups = ({ GET, POST, PATCH, DELETE }: Verbs) => ({
  list: async () => await GET('/groups', z.array(GroupMembership)),
  create: async (body: GroupCreate) => await POST('/groups', GroupMembership, body),
  members: async (id: string) => await GET(`/groups/${id}/members`, z.array(GroupMember)),
  addMember: async (id: string, body: GroupAddMember) =>
    await POST(`/groups/${id}/members`, GroupMember, body),
  removeMember: async (id: string, userId: string) =>
    await DELETE(`/groups/${id}/members/${userId}`, Ok),
  /** The caller's own membership: whether its editors read their training (#11). */
  setSharing: async (id: string, body: GroupMembershipPatch) =>
    await PATCH(`/groups/${id}/membership`, GroupMembership, body),
})

const media = ({ POST, UPLOAD }: Verbs) => ({
  link: async (body: { url: string; title?: string }) => await POST('/media/link', Media, body),
  /** An image, as a multipart form with a `file` field — the API's size and type limits apply. */
  upload: async (form: FormData) => await UPLOAD('/media', Media, form),
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
    today: today(v),
    review: review(v),
    athletes: athletes(v),
    equipment: equipment(v),
    groups: groups(v),
    media: media(v),
    tokens: tokens(v),
  } as const
}

export type ApiClient = ReturnType<typeof createApi>
