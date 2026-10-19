import { beforeEach, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  Exercise,
  GroupMembership,
  PersonalAccessTokenCreated,
  Workout,
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
  readonly alicesPat: string
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

  const alicesPat = expectContract(
    PersonalAccessTokenCreated,
    await post(alice, '/tokens', { name: 'claude' }),
  ).token

  return { crewId, bobsExerciseId, bobsWorkoutId, alicesWorkoutId, alicesSessionId, alicesPat }
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
  'GET /sessions/:id': {
    // Her own session stays hers, and each log names its exercise — while she can still see it.
    named: true,
    read: async (w) => await http(`/sessions/${w.alicesSessionId}`),
  },
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
      ]),
  },
  exercise_get: {
    named: true,
    read: async (w) => await tool(w, 'exercise_get', { exerciseId: w.bobsExerciseId }),
    allowed: async (w) => await toolAllowed(w, 'exercise_get', { exerciseId: w.bobsExerciseId }),
  },
  exercise_history: {
    // Dates and efforts, no name.
    named: false,
    read: async (w) => await tool(w, 'exercise_history', { exerciseId: w.bobsExerciseId }),
    allowed: async (w) =>
      await toolAllowed(w, 'exercise_history', { exerciseId: w.bobsExerciseId }),
  },
  library_audit: {
    named: true,
    read: async (w) => await tool(w, 'library_audit', { groupId: w.crewId }),
    allowed: async (w) => await toolAllowed(w, 'library_audit', { groupId: w.crewId }),
  },
  training_review: {
    named: true,
    read: async (w) => await tool(w, 'training_review', { weeks: 4 }),
  },
  workout_list: { named: true, read: async (w) => await tool(w, 'workout_list') },
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
    WorkoutSession,
    (await alice.wire(`/sessions/${w.alicesSessionId}`)).body,
  ).logs
  expect(loggedBefore.map((l) => l.exercise?.name)).toEqual(['Bobs Secret Lift'])
  const sessionsBefore = expectContract(
    page(WorkoutSessionSummary),
    (await alice.wire('/sessions')).body,
  )

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
  expect(sessionsAfter.items.map((s) => [s.workoutName, s.dayName])).toEqual(
    sessionsAfter.items.map(() => [null, null]),
  )

  // And each of her logs is still listed — a LEFT join onto the visible exercises — with the
  // exercise it names gone, not the log itself.
  const loggedAfter = expectContract(
    WorkoutSession,
    (await alice.wire(`/sessions/${w.alicesSessionId}`)).body,
  ).logs
  expect(loggedAfter.map((l) => l.id)).toEqual(loggedBefore.map((l) => l.id))
  expect(loggedAfter.map((l) => l.exercise)).toEqual([null])
})
