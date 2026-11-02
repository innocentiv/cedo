import { beforeEach, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  EntryTarget,
  Exercise,
  GroupMembership,
  PersonalAccessTokenCreated,
  Workout,
  SessionDetail,
  WorkoutSession,
  WorkoutSessionSummary,
  page,
} from '@cedo/contract'
import { createApp } from '../app.ts'
import { expectContract } from './contract.ts'
import { type TestApi, type TestUser, makeApi } from './harness.ts'

/**
 * Losing a group takes back everything it showed you — on EVERY read path, HTTP and MCP alike.
 *
 * Bob shares a group with Alice. Every name in it carries the sentinel `Bobs`. Alice trains against
 * it, favourites it, and builds her own plan around one of its exercises. Then Bob removes her,
 * through the real route. Afterwards no read Alice can make may contain the sentinel.
 *
 * The suite is exhaustive BY CONSTRUCTION: it reads the GET routes off the app and the read-only
 * tools off the MCP server, and fails when one has no case here. A new read path cannot skip it.
 * Each case also says whether it named Bob's things while Alice was still a member, so no case
 * passes because it never showed anything in the first place. See
 * docs/adr/0019-visible-relations.md.
 */

const SENTINEL = 'Bobs'

let h: TestApi
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  bob = await h.as('bob')
})

interface World {
  readonly crewId: string
  readonly bobsExerciseId: string
  readonly bobsWorkoutId: string
  readonly alicesWorkoutId: string
  readonly alicesSessionId: string
  /** On her own plan, which stays hers: its day still names Bob's exercise while she can see it. */
  readonly alicesOwnSessionId: string
  readonly alicesPat: string
  /** Bob shares his training with the crew, which Alice edits: she coaches him (#11). */
  readonly bobsSessionId: string
}

async function post(user: TestUser, path: string, body: unknown, method = 'POST') {
  const res = await user.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300)
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body
}

async function buildWorld(): Promise<World> {
  const crewId = expectContract(
    GroupMembership,
    await post(bob, '/groups', { name: 'Bobs Crew' }),
  ).id
  await post(bob, `/groups/${crewId}/members`, { username: alice.username, role: 'editor' })

  const bobsExerciseId = expectContract(
    Exercise,
    await post(bob, '/exercises', {
      name: 'Bobs Secret Lift',
      muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
    }),
  ).id
  await post(bob, `/exercises/${bobsExerciseId}/transfer`, { toGroupId: crewId })

  const bobsWorkoutId = expectContract(
    Workout,
    await post(bob, '/workouts', { name: 'Bobs Cutting Block' }),
  ).id
  const planNamed = (dayName: string) => ({
    days: [
      {
        name: dayName,
        entries: [
          {
            exerciseId: bobsExerciseId,
            progression: { kind: 'linear', incrementG: 2500, afterSuccesses: 1 },
            sets: [{ targetReps: 5, targetWeightG: 60_000 }],
          },
        ],
      },
    ],
  })
  await post(bob, `/workouts/${bobsWorkoutId}/plan`, planNamed('Bobs Leg Day'), 'PUT')
  await post(bob, `/workouts/${bobsWorkoutId}/transfer`, { toGroupId: crewId })

  // Alice's own plan, in her personal group, around Bob's exercise.
  const alicesWorkoutId = expectContract(
    Workout,
    await post(alice, '/workouts', { name: 'Alices Own Plan' }),
  ).id
  await post(alice, `/workouts/${alicesWorkoutId}/plan`, planNamed('Her Own Day'), 'PUT')

  await post(alice, `/exercises/${bobsExerciseId}/favourite`, {}, 'PUT')
  await post(alice, `/workouts/${bobsWorkoutId}/favourite`, {}, 'PUT')

  // Three finished sessions against Bob's plan: the minimum `stalled` considers.
  const bobsPlan = expectContract(Workout, (await alice.wire(`/workouts/${bobsWorkoutId}`)).body)
  const day = bobsPlan.days[0]
  const entry = day?.entries[0]
  if (day === undefined || entry === undefined) throw new Error('the plan did not save')
  let alicesSessionId = ''
  for (let i = 0; i < 3; i += 1) {
    const session = expectContract(
      WorkoutSession,
      await post(alice, '/sessions', { workoutId: bobsWorkoutId, dayId: day.id }),
    )
    alicesSessionId = session.id
    await post(alice, `/sessions/${session.id}/logs`, {
      exerciseId: bobsExerciseId,
      entryId: entry.id,
      weightG: 60_000,
      reps: 5,
    })
    await post(alice, `/sessions/${session.id}`, { endedAt: new Date().toISOString() }, 'PATCH')
  }

  const ownDay = expectContract(Workout, (await alice.wire(`/workouts/${alicesWorkoutId}`)).body)
    .days[0]
  const alicesOwnSessionId = expectContract(
    WorkoutSession,
    await post(alice, '/sessions', { workoutId: alicesWorkoutId, dayId: ownDay?.id }),
  ).id

  const alicesPat = expectContract(
    PersonalAccessTokenCreated,
    await post(alice, '/tokens', { name: 'claude' }),
  ).token

  // Bob trains on his own plan, and shares it with the crew — Alice, its editor, coaches him.
  await post(bob, `/groups/${crewId}/membership`, { sharesTraining: true }, 'PATCH')
  const bobsSessionId = expectContract(
    WorkoutSession,
    await post(bob, '/sessions', { workoutId: bobsWorkoutId, dayId: day.id }),
  ).id
  await post(bob, `/sessions/${bobsSessionId}/logs`, {
    exerciseId: bobsExerciseId,
    entryId: entry.id,
    weightG: 60_000,
    reps: 5,
  })
  // And says what his coach should remember (#41).
  await post(bob, '/notes', { text: `${SENTINEL} left knee is sore on lunges` })
  // And weighs himself (#42).
  await post(bob, '/weigh-ins', { day: new Date().toISOString().slice(0, 10), weightG: 82_400 })

  return {
    crewId,
    bobsExerciseId,
    bobsWorkoutId,
    alicesWorkoutId,
    alicesSessionId,
    alicesOwnSessionId,
    alicesPat,
    bobsSessionId,
  }
}

// ---------------------------------------------------------------------------------------------
// Reading as Alice
// ---------------------------------------------------------------------------------------------

const http = async (path: string): Promise<string> => JSON.stringify((await alice.wire(path)).body)
const httpAllowed = async (path: string): Promise<boolean> => (await alice.wire(path)).status < 300

const ToolCall = z.object({
  result: z
    .object({
      content: z.array(z.object({ text: z.string() })).optional(),
      tools: z
        .array(
          z.object({
            name: z.string(),
            annotations: z.object({ readOnlyHint: z.boolean().optional() }).optional(),
          }),
        )
        .optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.object({ message: z.string() }).optional(),
})

async function rpc(pat: string, method: string, params: unknown) {
  const response = await createApp().handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${pat}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const text = await response.text()
  const payload = text.startsWith('event:') ? (text.split('data: ')[1] ?? '{}') : text || '{}'
  return ToolCall.parse(JSON.parse(payload))
}

const tool = async (w: World, name: string, args: Record<string, unknown> = {}) =>
  JSON.stringify(await rpc(w.alicesPat, 'tools/call', { name, arguments: args }))
const toolAllowed = async (w: World, name: string, args: Record<string, unknown>) => {
  const reply = await rpc(w.alicesPat, 'tools/call', { name, arguments: args })
  return reply.result !== undefined && reply.result.isError !== true
}

/**
 * One read path, possibly several reads of it.
 *
 * - `named`: whether it names Bob's things while Alice is still a member — the control that keeps
 *   the "names nothing after" assertion from being vacuous.
 * - `allowed`: for a read of something that was only ever visible through the group, whether Alice
 *   may make it at all. It must be allowed before and refused after: a route whose payload carries
 *   ids rather than names would otherwise pass the sentinel check while still answering.
 */
interface Case {
  readonly named: boolean
  readonly read: (w: World) => Promise<string>
  readonly allowed?: (w: World) => Promise<boolean>
}

const all = async (reads: Promise<string>[]): Promise<string> =>
  (await Promise.all(reads)).join('\n')

const ROUTES: Record<string, Case> = {
  'GET /health': { named: false, read: async () => await http('/health') },
  'GET /openapi': { named: false, read: async () => await http('/openapi') },
  'GET /openapi/json': { named: false, read: async () => await http('/openapi/json') },
  'GET /auth/me': { named: true, read: async () => await http('/auth/me') },
  'GET /tokens/': { named: false, read: async () => await http('/tokens') },
  'GET /groups/': { named: true, read: async () => await http('/groups') },
  'GET /groups/:id/members': {
    // Bob's username, not his group's name.
    named: false,
    read: async (w) => await http(`/groups/${w.crewId}/members`),
    allowed: async (w) => await httpAllowed(`/groups/${w.crewId}/members`),
  },
  'GET /exercises/': {
    named: true,
    read: async (w) =>
      await all([
        http('/exercises?scope=all'),
        http('/exercises?scope=favourites'),
        http(`/exercises?scope=group&groupId=${w.crewId}`),
        http(`/exercises?q=${SENTINEL}`),
        http('/exercises?muscle=quadriceps'),
      ]),
  },
  'GET /exercises/recent': {
    // She logged Bob's exercise: it leads her picker while she can see it, and only then.
    named: true,
    read: async () => await http('/exercises/recent'),
  },
  'GET /exercises/:id': {
    named: true,
    read: async (w) => await http(`/exercises/${w.bobsExerciseId}`),
    allowed: async (w) => await httpAllowed(`/exercises/${w.bobsExerciseId}`),
  },
  'GET /exercises/:id/history': {
    // Logs carry ids, not names.
    named: false,
    read: async (w) => await http(`/exercises/${w.bobsExerciseId}/history`),
    allowed: async (w) => await httpAllowed(`/exercises/${w.bobsExerciseId}/history`),
  },
  'GET /workouts/': {
    named: true,
    read: async (w) =>
      await all([
        http('/workouts?scope=all'),
        http('/workouts?scope=favourites'),
        http(`/workouts?scope=group&groupId=${w.crewId}`),
        http(`/workouts?q=${SENTINEL}`),
      ]),
  },
  'GET /workouts/:id': {
    named: true,
    read: async (w) =>
      await all([http(`/workouts/${w.bobsWorkoutId}`), http(`/workouts/${w.alicesWorkoutId}`)]),
    allowed: async (w) => await httpAllowed(`/workouts/${w.bobsWorkoutId}`),
  },
  'GET /workouts/:id/progression': {
    named: true,
    read: async (w) =>
      await all([
        http(`/workouts/${w.bobsWorkoutId}/progression`),
        http(`/workouts/${w.alicesWorkoutId}/progression`),
      ]),
    allowed: async (w) => await httpAllowed(`/workouts/${w.bobsWorkoutId}/progression`),
  },
  'GET /sessions/': { named: true, read: async () => await http('/sessions') },
  'GET /review/': {
    // Her own sessions follow Bob's plan, on Bob's exercise: named while she can see them.
    named: true,
    read: async () => await http('/review?weeks=52'),
  },
  'GET /today/': {
    // Her own plan is current — her session in progress follows it — and its next day is the one
    // around Bob's exercise, named while she can still see it.
    named: true,
    read: async () =>
      await http(`/today?weekStart=${encodeURIComponent(new Date(0).toISOString())}`),
  },
  'GET /sessions/:id': {
    // Her own session stays hers, and each log names its exercise — while she can still see it. So
    // does the day it follows: Bob's plan out of reach after, her own plan's entry unavailable.
    named: true,
    read: async (w) =>
      await all([
        http(`/sessions/${w.alicesSessionId}`),
        http(`/sessions/${w.alicesOwnSessionId}`),
      ]),
  },
  'GET /sessions/:id/targets': {
    // Targets and last time's sets — numbers, never a name. Bob's plan out of reach after, the day's
    // entries leave with it: the read asks nothing of them.
    named: false,
    read: async (w) =>
      await all([
        http(`/sessions/${w.alicesSessionId}/targets`),
        http(`/sessions/${w.alicesOwnSessionId}/targets`),
      ]),
  },
  // Alice coaches Bob through the crew (#11): his training, named as she can see it — then nothing.
  'GET /athletes/': { named: true, read: async () => await http('/athletes') },
  'GET /athletes/:id/sessions': {
    named: true,
    read: async () => await http(`/athletes/${bob.userId}/sessions`),
    allowed: async () => await httpAllowed(`/athletes/${bob.userId}/sessions`),
  },
  'GET /athletes/:id/sessions/:sessionId': {
    named: true,
    read: async (w) => await http(`/athletes/${bob.userId}/sessions/${w.bobsSessionId}`),
    allowed: async (w) => await httpAllowed(`/athletes/${bob.userId}/sessions/${w.bobsSessionId}`),
  },
  'GET /athletes/:id/exercises/:exerciseId/history': {
    // Dates and efforts, no name.
    named: false,
    read: async (w) => await http(`/athletes/${bob.userId}/exercises/${w.bobsExerciseId}/history`),
    allowed: async (w) =>
      await httpAllowed(`/athletes/${bob.userId}/exercises/${w.bobsExerciseId}/history`),
  },
  'GET /athletes/:id/review': {
    // His days, by his plan's names, while she coaches him (#30).
    named: true,
    read: async () => await http(`/athletes/${bob.userId}/review?weeks=52`),
    allowed: async () => await httpAllowed(`/athletes/${bob.userId}/review`),
  },
  'GET /athletes/:id/equipment': {
    // What he trains with, by the list's items: nothing of the crew's to name (#34).
    named: false,
    read: async () => await http(`/athletes/${bob.userId}/equipment`),
    allowed: async () => await httpAllowed(`/athletes/${bob.userId}/equipment`),
  },
  'GET /athletes/:id/notes': {
    // What Bob said of himself, his coach's to read only while she coaches him (#41).
    named: true,
    read: async () => await http(`/athletes/${bob.userId}/notes`),
    allowed: async () => await httpAllowed(`/athletes/${bob.userId}/notes`),
  },
  'GET /athletes/:id/weigh-ins': {
    // His bodyweight: days and grams, nothing of the crew's to name (#42).
    named: false,
    read: async () => await http(`/athletes/${bob.userId}/weigh-ins?weeks=52`),
    allowed: async () => await httpAllowed(`/athletes/${bob.userId}/weigh-ins`),
  },
  // Her own weigh-ins.
  'GET /weigh-ins': { named: false, read: async () => await http('/weigh-ins') },
  // Her own notes: what she said of herself.
  'GET /notes': { named: false, read: async () => await http('/notes') },
  // Her own equipment: the list's items, which belong to nobody's group.
  'GET /equipment/': { named: false, read: async () => await http('/equipment') },
  // Curator-only, and Alice is no curator: she is refused before and after.
  'GET /admin/status': { named: false, read: async () => await http('/admin/status') },
  'GET /admin/slow-queries': { named: false, read: async () => await http('/admin/slow-queries') },
}

/** Routes that serve nothing owned, with the reason. */
const NOT_OWNED: Record<string, string> = {
  'GET /media/:id/blob':
    'media are not ownable: content-addressed, served unauthenticated (ADR-0009)',
  'GET /media/:id/thumb':
    'media are not ownable: content-addressed, served unauthenticated (ADR-0009)',
}

const TOOLS: Record<string, Case> = {
  muscle_list: { named: false, read: async (w) => await tool(w, 'muscle_list') },
  exercise_search: {
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'exercise_search'),
        tool(w, 'exercise_search', { q: SENTINEL }),
        tool(w, 'exercise_search', { scope: 'favourites' }),
        tool(w, 'exercise_search', { scope: 'group', groupId: w.crewId }),
      ]),
  },
  exercise_get: {
    named: true,
    read: async (w) => await tool(w, 'exercise_get', { exerciseId: w.bobsExerciseId }),
    allowed: async (w) => await toolAllowed(w, 'exercise_get', { exerciseId: w.bobsExerciseId }),
  },
  exercise_history: {
    // Dates and efforts, no name — hers, and Bob's while she coaches him.
    named: false,
    read: async (w) =>
      await all([
        tool(w, 'exercise_history', { exerciseId: w.bobsExerciseId }),
        tool(w, 'exercise_history', { exerciseId: w.bobsExerciseId, athlete: bob.userId }),
      ]),
    allowed: async (w) =>
      await toolAllowed(w, 'exercise_history', {
        exerciseId: w.bobsExerciseId,
        athlete: bob.userId,
      }),
  },
  library_audit: {
    named: true,
    read: async (w) => await tool(w, 'library_audit', { groupId: w.crewId }),
    allowed: async (w) => await toolAllowed(w, 'library_audit', { groupId: w.crewId }),
  },
  training_review: {
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'training_review', { weeks: 4 }),
        tool(w, 'training_review', { weeks: 4, athlete: bob.userId }),
      ]),
  },
  workout_list: {
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'workout_list'),
        tool(w, 'workout_list', { scope: 'group', groupId: w.crewId }),
      ]),
  },
  group_list: { named: true, read: async (w) => await tool(w, 'group_list') },
  workout_get: {
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'workout_get', { workoutId: w.bobsWorkoutId }),
        tool(w, 'workout_get', { workoutId: w.alicesWorkoutId }),
      ]),
    allowed: async (w) => await toolAllowed(w, 'workout_get', { workoutId: w.bobsWorkoutId }),
  },
  workout_get_editable: {
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'workout_get_editable', { workoutId: w.bobsWorkoutId }),
        tool(w, 'workout_get_editable', { workoutId: w.alicesWorkoutId }),
      ]),
    allowed: async (w) =>
      await toolAllowed(w, 'workout_get_editable', { workoutId: w.bobsWorkoutId }),
  },
  workout_progression: {
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'workout_progression', { workoutId: w.bobsWorkoutId }),
        tool(w, 'workout_progression', { workoutId: w.alicesWorkoutId }),
      ]),
    allowed: async (w) =>
      await toolAllowed(w, 'workout_progression', { workoutId: w.bobsWorkoutId }),
  },
  // Alice coaches Bob (#11): the list names the crew, his sessions his plan — then nothing.
  athlete_list: { named: true, read: async (w) => await tool(w, 'athlete_list') },
  session_list: {
    named: true,
    read: async (w) =>
      await all([tool(w, 'session_list'), tool(w, 'session_list', { athlete: bob.userId })]),
    allowed: async (w) => await toolAllowed(w, 'session_list', { athlete: bob.userId }),
  },
  session_get: {
    // Each run of sets names its exercise while she can see it — hers, and Bob's as his coach.
    named: true,
    read: async (w) =>
      await all([
        tool(w, 'session_get', { sessionId: w.alicesSessionId }),
        tool(w, 'session_get', { sessionId: w.bobsSessionId, athlete: bob.userId }),
      ]),
    allowed: async (w) =>
      await toolAllowed(w, 'session_get', { sessionId: w.bobsSessionId, athlete: bob.userId }),
  },
  equipment_get: {
    // The list's items — hers, and Bob's while she coaches him (#34).
    named: false,
    read: async (w) =>
      await all([tool(w, 'equipment_get'), tool(w, 'equipment_get', { athlete: bob.userId })]),
    allowed: async (w) => await toolAllowed(w, 'equipment_get', { athlete: bob.userId }),
  },
  note_list: {
    // Hers, and what Bob said of himself while she coaches him (#41).
    named: true,
    read: async (w) =>
      await all([tool(w, 'note_list'), tool(w, 'note_list', { athlete: bob.userId })]),
    allowed: async (w) => await toolAllowed(w, 'note_list', { athlete: bob.userId }),
  },
  weigh_in_list: {
    // His bodyweight while she coaches him: days and grams, nothing of the crew's (#42).
    named: false,
    read: async (w) =>
      await all([
        tool(w, 'weigh_in_list', { weeks: 52 }),
        tool(w, 'weigh_in_list', { weeks: 52, athlete: bob.userId }),
      ]),
    allowed: async (w) => await toolAllowed(w, 'weigh_in_list', { athlete: bob.userId }),
  },
  // Curator-only.
  platform_status: { named: false, read: async (w) => await tool(w, 'platform_status') },
  db_slow_queries: { named: false, read: async (w) => await tool(w, 'db_slow_queries') },
}

test('every GET route has a case, and every case is a GET route', () => {
  const routes = createApp()
    .routes.filter((r) => r.method === 'GET')
    .map((r) => `GET ${r.path}`)
  const covered = [...Object.keys(ROUTES), ...Object.keys(NOT_OWNED)]

  expect(routes.filter((r) => !covered.includes(r))).toEqual([])
  expect(covered.filter((c) => !routes.includes(c))).toEqual([])
})

test('every read-only MCP tool has a case, and every case is a read-only tool', async () => {
  const w = await buildWorld()
  const listed = (await rpc(w.alicesPat, 'tools/list', {})).result?.tools ?? []
  const reads = listed.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name)

  // Coverage keys off the annotation, so a tool that omits it would drop out of this suite unseen.
  const unannotated = listed.filter((t) => typeof t.annotations?.readOnlyHint !== 'boolean')
  expect(unannotated.map((t) => t.name)).toEqual([])
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.filter((r) => !(r in TOOLS))).toEqual([])
  expect(Object.keys(TOOLS).filter((t) => !reads.includes(t))).toEqual([])
})

test('losing a group takes back every name it showed, on every read path', async () => {
  const w = await buildWorld()
  const cases = [
    ...Object.entries(ROUTES).map(([name, c]) => [name, c] as const),
    ...Object.entries(TOOLS).map(([name, c]) => [`mcp ${name}`, c] as const),
  ]

  const before = await Promise.all(cases.map(async ([, c]) => await c.read(w)))
  const silentWhileMember = cases
    .filter(([, c], i) => c.named && !(before[i] ?? '').includes(SENTINEL))
    .map(([name]) => name)
  // Each of these must actually show Bob's things first, or "shows nothing after" proves nothing.
  expect(silentWhileMember).toEqual([])
  const gated = cases.filter(([, c]) => c.allowed !== undefined)
  const allowedBefore = await Promise.all(gated.map(async ([, c]) => await c.allowed?.(w)))
  expect(gated.filter((_, i) => allowedBefore[i] !== true).map(([name]) => name)).toEqual([])
  const loggedBefore = expectContract(
    SessionDetail,
    (await alice.wire(`/sessions/${w.alicesSessionId}`)).body,
  ).logs
  expect(loggedBefore.map((l) => l.exercise?.name)).toEqual(['Bobs Secret Lift'])
  const sessionsBefore = expectContract(
    page(WorkoutSessionSummary),
    (await alice.wire('/sessions')).body,
  )
  // What her session on Bob's plan asks of each entry: his prescriptions, while she is a member.
  const targetsOf = async () =>
    expectContract(
      z.array(EntryTarget),
      (await alice.wire(`/sessions/${w.alicesSessionId}/targets`)).body,
    )
  expect(await targetsOf()).not.toEqual([])

  const removed = await bob.wire(`/groups/${w.crewId}/members/${alice.userId}`, {
    method: 'DELETE',
  })
  expect(removed.status).toBeLessThan(300)

  const after = await Promise.all(cases.map(async ([, c]) => await c.read(w)))
  const leaks = cases.flatMap(([name], i) => {
    const body = after[i] ?? ''
    return body.includes(SENTINEL) ? [`${name}: ${body.slice(0, 300)}`] : []
  })
  expect(leaks).toEqual([])

  // Refused outright, not merely answered without names.
  const allowedAfter = await Promise.all(gated.map(async ([, c]) => await c.allowed?.(w)))
  expect(gated.filter((_, i) => allowedAfter[i] !== false).map(([name]) => name)).toEqual([])

  // Her own sessions are hers forever: every one still listed, the lost names null — a LEFT join
  // onto the relation, not an INNER one that would drop them. See docs/03-domain-model.md.
  const sessionsAfter = expectContract(
    page(WorkoutSessionSummary),
    (await alice.wire('/sessions')).body,
  )
  expect(sessionsAfter.items.map((s) => s.id)).toEqual(sessionsBefore.items.map((s) => s.id))
  // Bob's plan is out of reach; her own plan, and its day, are still hers to name.
  expect(sessionsAfter.items.map((s) => [s.workoutName, s.dayName])).toEqual(
    sessionsAfter.items.map((s) =>
      s.id === w.alicesOwnSessionId ? ['Alices Own Plan', 'Her Own Day'] : [null, null],
    ),
  )

  // And each of her logs is still listed — a LEFT join onto the visible exercises — with the
  // exercise it names gone, not the log itself.
  const sessionAfter = expectContract(
    SessionDetail,
    (await alice.wire(`/sessions/${w.alicesSessionId}`)).body,
  )
  const loggedAfter = sessionAfter.logs
  expect(loggedAfter.map((l) => l.id)).toEqual(loggedBefore.map((l) => l.id))
  expect(loggedAfter.map((l) => l.exercise)).toEqual([null])
  // The plan it followed is Bob's, and out of her reach now — said, not guessed from a failed read.
  expect(sessionAfter.plan).toEqual({ reachable: false })
  // Nor are his prescriptions offered any more: numbers carry no name, so the sentinel cannot tell.
  expect(await targetsOf()).toEqual([])
})
