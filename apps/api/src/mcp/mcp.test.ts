import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  Exercise,
  GroupMembership,
  MCP_SERVER_NAME,
  Me,
  McpClientConfig,
  MUSCLE_SLUGS,
  PersonalAccessTokenCreated,
  aiClientConfigs,
  mcpAddress,
  type TrackingMode,
  Workout,
  WorkoutSession,
  PlanSave,
  ageLine,
  ageThisYear,
  formatCalendarDay,
  page,
} from '@cedo/contract'
import { createApp } from '../app.ts'
import { seedLibrary } from '../db/seed.ts'
import { EXERCISE_LIBRARY } from '../db/seed-data/exercises.ts'
import { expectContract } from '../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'
import { reviewFixture } from '../modules/review/review-fixture.ts'

/**
 * Drives the MCP server exactly as an AI client does: JSON-RPC over HTTP at /mcp, authenticated by
 * a personal access token. Nothing here reaches into the handler directly, because the parts most
 * likely to break — auth, framing, schema publication — are the ones a direct call skips.
 */

let h: TestApi
let alice: TestUser
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  h = await makeApi()
  alice = await h.as('alice')
  app = createApp()
})

async function mintPat(user: TestUser): Promise<string> {
  const res = await user.wire('/tokens', {
    method: 'POST',
    body: JSON.stringify({ name: 'claude' }),
  })
  return expectContract(PersonalAccessTokenCreated, res.body).token
}

const RpcResult = z.object({
  result: z
    .object({
      tools: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            inputSchema: z.unknown().optional(),
            annotations: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
      content: z.array(z.object({ type: z.string(), text: z.string() })).optional(),
      isError: z.boolean().optional(),
    })
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
})

async function rpc(pat: string | null, method: string, params: unknown = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  })
  if (pat !== null) headers.set('authorization', `Bearer ${pat}`)

  const response = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const text = await response.text()
  // The handler frames replies as server-sent events by default.
  const payload = text.startsWith('event:') ? (text.split('data: ')[1] ?? '{}') : text || '{}'
  return { status: response.status, body: RpcResult.safeParse(JSON.parse(payload)).data ?? {} }
}

const callTool = async (pat: string, name: string, args: unknown = {}) =>
  await rpc(pat, 'tools/call', { name, arguments: args })

type RpcBody = z.output<typeof RpcResult>
const textOf = (body: RpcBody) => body.result?.content?.map((c) => c.text).join('\n') ?? ''

/** A call over HTTP as `user` that must succeed: the setup a tool is then asked about. */
const post = async (user: TestUser, path: string, body: unknown, method = 'POST') => {
  const res = await user.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${String(res.status)}`)
  return res.body
}

describe('authentication', () => {
  test('rejects a request with no token', async () => {
    const { status } = await rpc(null, 'initialize', {})
    expect(status).toBe(401)
  })

  test('rejects an unknown token', async () => {
    const { status } = await rpc('a'.repeat(43), 'initialize', {})
    expect(status).toBe(401)
  })

  /** A browser session and an AI credential are deliberately not interchangeable. */
  test('rejects a SESSION token — MCP requires a personal access token', async () => {
    const { status } = await rpc(alice.token, 'initialize', {})
    expect(status).toBe(401)
  })

  test('accepts a personal access token', async () => {
    const pat = await mintPat(alice)
    const { status } = await rpc(pat, 'initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })
    expect(status).toBe(200)
  })

  /**
   * "Connect your AI" end to end, short of the proxy: a token made as the screen makes it, and the
   * JSON config the screen shows, read the way a client reads it — its URL, its headers, nothing
   * else. Here the API is the root; behind Caddy it is `/api`, which the e2e journey covers.
   */
  test('the config "Connect your AI" shows reaches the MCP server', async () => {
    const created = await alice.wire('/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 'Your AI', expiresInDays: null }),
    })
    const { token } = expectContract(PersonalAccessTokenCreated, created.body)
    const config = McpClientConfig.parse(
      JSON.parse(aiClientConfigs(mcpAddress('http://localhost'), token).json),
    )
    const server = config.mcpServers[MCP_SERVER_NAME]
    if (server === undefined) throw new Error(`No ${MCP_SERVER_NAME} server in the config`)

    const response = await app.handle(
      new Request(server.url, {
        method: 'POST',
        headers: {
          ...server.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('training_review')
  })
})

describe('the published tool list', () => {
  test('publishes every tool with a JSON Schema and a read-only or write annotation', async () => {
    const pat = await mintPat(alice)
    const { body } = await rpc(pat, 'tools/list')
    const tools = body.result?.tools ?? []

    expect(tools.length).toBeGreaterThanOrEqual(15)
    for (const tool of tools) {
      expect(typeof tool.annotations?.['readOnlyHint']).toBe('boolean')
    }
  })

  /** No delete tool exists at all — a confused AI must not be able to destroy training history. */
  test('exposes no destructive tool', async () => {
    const pat = await mintPat(alice)
    const { body } = await rpc(pat, 'tools/list')
    const names = (body.result?.tools ?? []).map((t) => t.name)
    expect(names.filter((n) => /delete|remove|destroy/u.test(n))).toEqual([])
  })

  test('advertises the valid muscle slugs, so the model need not guess', async () => {
    const pat = await mintPat(alice)
    const { body } = await rpc(pat, 'tools/list')
    const search = (body.result?.tools ?? []).find((t) => t.name === 'exercise_search')
    expect(JSON.stringify(search)).toContain('quadriceps')
  })
})

describe('library curation', () => {
  test('muscle_list returns the fixed set', async () => {
    const pat = await mintPat(alice)
    const out = textOf((await callTool(pat, 'muscle_list')).body)
    expect(out).toContain('quadriceps')
    expect(out).toContain('sum to exactly 100')
  })

  test('exercise_search returns compact lines, not JSON', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const pat = await mintPat(alice)
    const out = textOf((await callTool(pat, 'exercise_search', { q: 'squat' })).body)

    expect(out).toContain('Barbell Back Squat')
    expect(out).toContain('quadriceps 45%')
    // What it needs, by the slugs exercise_update takes (#33).
    expect(out).toContain('Barbell Back Squat | barbell + rack |')
    // Compactness is the point: JSON would be an order of magnitude larger.
    expect(out.startsWith('{')).toBe(false)
  })

  test('a non-curator cannot write to the shared library', async () => {
    const pat = await mintPat(alice)
    const result = await callTool(pat, 'exercise_create', {
      name: 'Sneaky Lift',
      muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      shared: true,
    })
    expect(JSON.stringify(result.body)).toContain('curator access')
  })

  test('but can create in their own group', async () => {
    const pat = await mintPat(alice)
    const out = textOf(
      (
        await callTool(pat, 'exercise_create', {
          name: 'My Lift',
          muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
        })
      ).body,
    )
    expect(out).toContain('Created.')
    expect(out).toContain('My Lift')
    expect(out).toContain('needs: equipment not described')
  })

  test('an exercise says what it needs, or that it needs nothing, and the audit names the unsaid', async () => {
    const pat = await mintPat(alice)
    const make = async (name: string, equipment?: unknown) =>
      textOf(
        (
          await callTool(pat, 'exercise_create', {
            name,
            muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
            ...(equipment === undefined ? {} : { equipment }),
          })
        ).body,
      )
    expect(await make('Step-Up', ['dumbbells', 'flat_bench'])).toContain(
      'needs: dumbbells + flat_bench',
    )
    expect(await make('Sissy Squat', [])).toContain('needs: no equipment')
    await make('Mystery Lift')

    const audit = textOf(
      (await callTool(pat, 'library_audit', { groupId: alice.personalGroupId })).body,
    )
    const unsaid = audit.split('Equipment not described')[1]?.split('\n\n')[0]
    expect(unsaid).toBe(' (1):\n  Mystery Lift')
  })

  test('contract invariants are enforced through MCP exactly as over HTTP', async () => {
    const pat = await mintPat(alice)
    const result = await callTool(pat, 'exercise_create', {
      name: 'Bad Lift',
      muscles: [{ muscle: 'quadriceps', loadPct: 50 }],
    })
    expect(JSON.stringify(result.body)).toContain('100')
  })

  test('library_audit reports duplicates and thin coverage', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const pat = await mintPat(alice)
    const out = textOf((await callTool(pat, 'library_audit')).body)
    expect(out).toContain(`${EXERCISE_LIBRARY.length} exercises`)
    expect(out).toMatch(/Possible duplicates|Thin muscle coverage/u)
  })
})

/**
 * Which group owns each line (#47). A curator edits the library and their own group alike, so
 * `read-only` cannot tell a copy from the library exercise it was copied from: the owning group can.
 */
describe('every line names its owning group', () => {
  const squad = async (user: TestUser) =>
    expectContract(GroupMembership, await post(user, '/groups', { name: 'Squad' }))
  /** The id a line ends with. */
  const idOf = (line: string) => {
    const id = /\| ([0-9a-f-]{36})$/u.exec(line)?.[1]
    if (id === undefined) throw new Error(`No id ending: ${line}`)
    return id
  }

  test('a curator tells the library exercise from their copies of it', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    await h.curator(alice)
    const pat = await mintPat(alice)
    const theirs = await squad(alice)
    const search = async () =>
      textOf((await callTool(pat, 'exercise_search', { q: 'Barbell Back Squat' })).body)
    const original = idOf(await search())
    await callTool(pat, 'exercise_duplicate', { exerciseId: original })
    await callTool(pat, 'exercise_duplicate', { exerciseId: original, toGroupId: theirs.id })

    const flags = (await search())
      .split('\n')
      .map((line) => /\| \[([^\]]*)\] \|/u.exec(line)?.[1] ?? line)
      .toSorted((a, b) => a.localeCompare(b))
    expect(flags).toEqual(['library', 'mine', 'Squad'])
  })

  test('a reader is told who owns what they cannot edit, by name', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const pat = await mintPat(alice)
    const line = textOf(
      (await callTool(pat, 'exercise_search', { q: 'Barbell Back Squat', limit: 1 })).body,
    )
    expect(line).toContain('| [library, read-only] |')

    const detail = textOf((await callTool(pat, 'exercise_get', { exerciseId: idOf(line) })).body)
    expect(detail).toContain('owning group: library')
    expect(detail).toContain('editable: no')
    expect(detail).not.toContain('another group')
  })

  test('workouts too, in their lines and at the head of a plan', async () => {
    const pat = await mintPat(alice)
    const theirs = await squad(alice)
    const plan = expectContract(
      Workout,
      await post(alice, '/workouts', { name: 'Push', notes: null }),
    )
    await callTool(pat, 'workout_duplicate', { workoutId: plan.id, toGroupId: theirs.id })

    const lines = textOf((await callTool(pat, 'workout_list')).body).split('\n')
    const owningGroups = lines.map((line) => line.split(' | ')[2] ?? line)
    expect(owningGroups.toSorted((a, b) => a.localeCompare(b))).toEqual(['[mine]', '[Squad]'])

    const head = textOf((await callTool(pat, 'workout_get', { workoutId: plan.id })).body)
    expect(head.split('\n')[0]).toBe(`Push  (${plan.id})  [mine]`)
  })
})

/**
 * Group ids, for the tools that take one (#52): `exercise_duplicate`'s `toGroupId`, `library_audit`'s
 * `groupId`, and a search narrowed to one group. Named as every line names an owning group.
 */
describe('groups, and a list narrowed to one', () => {
  const squadOf = async (user: TestUser) =>
    expectContract(GroupMembership, await post(user, '/groups', { name: 'Squad' }))

  test('group_list names each of your groups, your role in it, and its id', async () => {
    const theirs = await squadOf(alice)
    const lines = textOf((await callTool(await mintPat(alice), 'group_list')).body).split('\n')
    expect(lines.toSorted((a, b) => a.localeCompare(b))).toEqual([
      `library | reader | ${h.groupId}`,
      `mine | editor | ${alice.personalGroupId}`,
      `Squad | editor | ${theirs.id}`,
    ])
  })

  test('exercise_search and workout_list with `scope: group` list that group’s alone', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const theirs = await squadOf(alice)
    const pat = await mintPat(alice)
    const squat = expectContract(
      page(Exercise),
      (await alice.wire('/exercises?q=Barbell%20Back%20Squat&limit=1')).body,
    ).items[0]
    await callTool(pat, 'exercise_duplicate', { exerciseId: squat?.id, toGroupId: theirs.id })
    const plan = expectContract(
      Workout,
      await post(alice, '/workouts', { name: 'Push', notes: null }),
    )
    await callTool(pat, 'workout_duplicate', { workoutId: plan.id, toGroupId: theirs.id })
    const inSquad = { scope: 'group', groupId: theirs.id }

    const exercises = textOf((await callTool(pat, 'exercise_search', inSquad)).body).split('\n')
    expect(exercises.map((line) => line.split(' | ')[0])).toEqual(['Barbell Back Squat'])
    expect(exercises[0]).toContain('[Squad')

    const workouts = textOf((await callTool(pat, 'workout_list', inSquad)).body).split('\n')
    expect(workouts).toHaveLength(1)
    expect(workouts[0]).toContain('| [Squad] |')
  })

  test('`scope: group` without a groupId is refused by both, not read as every group', async () => {
    const pat = await mintPat(alice)
    for (const name of ['exercise_search', 'workout_list']) {
      // oxlint-disable-next-line no-await-in-loop -- one tool, then the other.
      const { body } = await callTool(pat, name, { scope: 'group' })
      expect(body.result?.isError).toBe(true)
      expect(textOf(body)).toContain('groupId')
    }
  })
})

/**
 * The library is read-only to all but curators; a copy is how an AI adapts one of its exercises for
 * someone — never by asking for curator rights. The same service as POST /exercises/:id/duplicate.
 */
describe('exercise_duplicate', () => {
  const findOne = async (user: TestUser, query: string) => {
    const [found] = expectContract(
      page(Exercise),
      (await user.wire(`/exercises?${query}`)).body,
    ).items
    if (found === undefined) throw new Error(`Nothing matched ${query}`)
    return found
  }

  test('copies a library exercise into your own group, where you can change it', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const squat = await findOne(alice, 'q=Barbell%20Back%20Squat&limit=1')
    const pat = await mintPat(alice)

    const { body } = await callTool(pat, 'exercise_duplicate', { exerciseId: squat.id })
    expect(body.result?.isError).not.toBe(true)
    expect(textOf(body)).toContain('Duplicated.')

    const copy = await findOne(alice, 'scope=mine&q=Barbell%20Back%20Squat')
    expect(copy.id).not.toBe(squat.id)
    expect(copy.ownerGroupId).toBe(alice.personalGroupId)
    expect(copy.canEdit).toBe(true)
    expect(copy.muscles).toEqual(squat.muscles)
    // The seed gives it a description and a media link, and no instructions — so those two pin it.
    expect(squat.description).not.toBe('')
    expect(squat.media).not.toEqual([])
    expect(copy.description).toBe(squat.description)
    expect(copy.media.map((m) => m.id)).toEqual(squat.media.map((m) => m.id))
  })

  test('goes nowhere you cannot edit — not even the library it came from', async () => {
    await seedLibrary(h.groupId, h.systemUserId)
    const squat = await findOne(alice, 'q=Barbell%20Back%20Squat&limit=1')
    const pat = await mintPat(alice)

    const { body } = await callTool(pat, 'exercise_duplicate', {
      exerciseId: squat.id,
      toGroupId: h.groupId,
    })
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('No such group')
  })

  test("cannot copy what the caller cannot see — another user's own exercise", async () => {
    const bob = await h.as('bob')
    const created = await bob.wire('/exercises', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bob Lift', muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
    })
    const theirs = expectContract(Exercise, created.body)
    const pat = await mintPat(alice)

    const { body } = await callTool(pat, 'exercise_duplicate', { exerciseId: theirs.id })
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('No such exercise')
  })
})

/** The same choice of where the copy goes as exercise_duplicate, through the same input. */
describe('workout_duplicate', () => {
  const aWorkout = async (user: TestUser) =>
    expectContract(
      Workout,
      (
        await user.wire('/workouts', {
          method: 'POST',
          body: JSON.stringify({ name: 'Push', notes: null }),
        })
      ).body,
    )
  /** Where the copy the tool names landed. */
  const landedIn = async (user: TestUser, out: string) => {
    const copyId = /workout ([0-9a-f-]{36})/u.exec(out)?.[1]
    if (copyId === undefined) throw new Error(`No copy named in: ${out}`)
    return expectContract(Workout, (await user.wire(`/workouts/${copyId}`)).body).ownerGroupId
  }

  test('copies into your personal group by default', async () => {
    const plan = await aWorkout(alice)
    const pat = await mintPat(alice)
    const { body } = await callTool(pat, 'workout_duplicate', { workoutId: plan.id })
    expect(await landedIn(alice, textOf(body))).toBe(alice.personalGroupId)
  })

  test('or into another group you edit, when `toGroupId` names it', async () => {
    const squad = expectContract(
      GroupMembership,
      (await alice.wire('/groups', { method: 'POST', body: JSON.stringify({ name: 'Squad' }) }))
        .body,
    )
    const plan = await aWorkout(alice)
    const pat = await mintPat(alice)
    const { body } = await callTool(pat, 'workout_duplicate', {
      workoutId: plan.id,
      toGroupId: squad.id,
    })
    expect(await landedIn(alice, textOf(body))).toBe(squad.id)
  })

  test('never into a group you only read', async () => {
    const plan = await aWorkout(alice)
    const pat = await mintPat(alice)
    const { body } = await callTool(pat, 'workout_duplicate', {
      workoutId: plan.id,
      toGroupId: h.groupId,
    })
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('No such group')
  })
})

describe('training review', () => {
  /** Through the tool, as the AI would; the id is read back out of its text. */
  async function createExercise(
    pat: string,
    name: string,
    muscle: string,
    tracking: TrackingMode = 'weight_reps',
  ): Promise<string> {
    const created = textOf(
      (
        await callTool(pat, 'exercise_create', {
          name,
          tracking,
          muscles: [{ muscle, loadPct: 100 }],
        })
      ).body,
    )
    const id = created.match(/\(([0-9a-f-]{36})\)/u)?.[1]
    if (id === undefined) throw new Error(`could not read the id of ${name}`)
    return id
  }

  test('reports no history for a new user rather than failing', async () => {
    const pat = await mintPat(alice)
    const out = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    expect(out).toContain('0 sessions')
  })

  test('a logged session flows through to the review and to history', async () => {
    const pat = await mintPat(alice)
    const exerciseId = await createExercise(pat, 'Test Squat', 'quadriceps')

    await callTool(pat, 'session_log', {
      sets: [
        { exerciseId, weightG: 100_000, reps: 5 },
        { exerciseId, weightG: 100_000, reps: 5 },
      ],
    })

    const review = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    expect(review).toContain('1 sessions')
    expect(review).toContain('quadriceps')

    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId })).body)
    expect(history).toContain('5 × 100 kg')
  })

  /** How hard each set was is half of what it says: the AI reads it as it logs it. */
  test('history carries each set’s reps in reserve, as the app says them', async () => {
    const pat = await mintPat(alice)
    const exerciseId = await createExercise(pat, 'Test Bench', 'pectoralis_major')
    await callTool(pat, 'session_log', {
      sets: [
        { exerciseId, weightG: 60_000, reps: 5, reserve: 1 },
        { exerciseId, weightG: 60_000, reps: 5, reserve: 2 },
        { exerciseId, weightG: 60_000, reps: 5 },
      ],
    })

    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId })).body)
    // "2", not "2.0": a numeric read back as a string, unconverted, would say so.
    expect(history).toContain('5 × 60 kg · 1 in reserve, 5 × 60 kg · 2 in reserve, 5 × 60 kg')
    expect(history).not.toContain('RPE')
    // The session's best estimated max: 5 reps with 2 in reserve, as if 7 — 60 × (1 + 7/30).
    expect(history).toContain('· estimated max 74 kg')
  })

  /** The AI reads a weighted pull-up as the app shows it — added load, not a 20 kg lift. */
  test('history describes a bodyweight movement in its own terms', async () => {
    const pat = await mintPat(alice)
    const exerciseId = await createExercise(
      pat,
      'Weighted Pull-up',
      'latissimus_dorsi',
      'bodyweight_reps',
    )
    await callTool(pat, 'session_log', {
      sets: [{ exerciseId, weightG: 20_000, reps: 6 }],
    })

    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId })).body)
    expect(history).toContain('6 × bodyweight +20 kg')
  })

  /**
   * The AI reads in the person's unit — it writes for them — while what it SENDS stays in grams,
   * the unit every tool input is in. The unit is read with the token, so a change applies at once.
   */
  test('someone who reads pounds is written to in pounds', async () => {
    const pat = await mintPat(alice)
    const exerciseId = await createExercise(pat, 'Test Squat', 'quadriceps')
    await callTool(pat, 'session_log', {
      sets: [{ exerciseId, weightG: 100_000, reps: 5 }],
    })
    await alice.wire('/auth/me', { method: 'PATCH', body: JSON.stringify({ weightUnit: 'lb' }) })

    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId })).body)
    expect(history).toContain('5 × 220.46 lb')
    expect(history).not.toContain('kg')
  })

  /** The deload triggers, said beside the stall: what the AI acts on by saving a lighter plan. */
  test('a lift falling and one drifting read as deload signals', async () => {
    const pat = await mintPat(alice)
    const bench = await createExercise(pat, 'Test Bench', 'pectoralis_major')
    const row = await createExercise(pat, 'Test Row', 'latissimus_dorsi')
    for (const [benchKg, rowReserve] of [
      [66, 3],
      [63, 3],
      [60, 1],
      [57, 1],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- sessions in order: what is under test.
      await callTool(pat, 'session_log', {
        sets: [
          { exerciseId: bench, weightG: benchKg * 1000, reps: 5 },
          { exerciseId: row, weightG: 50_000, reps: 8, reserve: rowReserve },
        ],
      })
    }

    const review = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    // 66 kg × 7/6 is 77 kg; 57 kg, 66.5 kg.
    expect(review).toContain(
      'Falling (estimated max from what was lifted, down 2+ sessions running):',
    )
    expect(review).toContain('Test Bench: down in each of the latest 3 sessions, 77 kg → 66.5 kg')
    expect(review).toContain(
      'Effort drift (reps in reserve down 1+ at the same set, in each of the latest 2 sessions):',
    )
    expect(review).toContain('Test Row at 8 × 50 kg: 3 → 1 in reserve')
  })

  /** Every effort reaches the AI as the app shows it. See `stalled.test.ts` for the history. */
  test('a stalled movement reads in its own terms, and a muscle’s work as sets', async () => {
    const pat = await mintPat(alice)
    const pullUp = await createExercise(
      pat,
      'Weighted Pull-up',
      'latissimus_dorsi',
      'bodyweight_reps',
    )
    const plank = await createExercise(pat, 'Plank', 'rectus_abdominis', 'duration')
    const squat = await createExercise(pat, 'Test Squat', 'quadriceps')
    const bench = await createExercise(pat, 'Test Bench', 'pectoralis_major')

    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- three sessions, in order: what is under test.
      await callTool(pat, 'session_log', {
        sets: [
          { exerciseId: pullUp, weightG: 20_000, reps: 6 },
          { exerciseId: plank, durationS: 60 },
          { exerciseId: squat, weightG: 100_000 + i * 2500, reps: 5 },
          { exerciseId: bench, weightG: 60_000, reps: 5, reserve: 2 },
        ],
      })
    }

    const review = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    expect(review).toContain('Stalled (the same top set, 3+ sessions running):')
    expect(review).toContain('Weighted Pull-up: 3 sessions at 6 × bodyweight +20 kg')
    expect(review).toContain('Plank: 3 sessions at 1:00')
    // A weight lift's stall says what it is worth: the estimated max of the set it is stuck at —
    // its reserve counted, as exercise_history counts it: 2 in reserve, so 60 × (1 + 7/30).
    expect(review).toContain('Test Bench: 3 sessions at 5 × 60 kg (estimated max 74 kg)')
    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId: bench })).body)
    expect(history).toContain('· estimated max 74 kg')
    expect(history).toContain('Stalled: 3 sessions at 5 × 60 kg')
    expect(review).not.toContain('Test Squat: 3 sessions')
    // Three sets, 5 × (100 + 102.5 + 105) kg lifted.
    expect(review).toContain('quadriceps: 3 sets, 1537.5 kg lifted (no prior data)')
    // A plank lifts nothing, and is still three sets of work — it used to read "0kg".
    expect(review).toContain('rectus_abdominis: 3 sets (no prior data)')
    // The weighted pull-up lifted its added 20 kg, 6 reps a set, three times over.
    expect(review).toContain('latissimus_dorsi: 3 sets, 360 kg lifted (no prior data)')
    // Every muscle named, and none declined: neither line has anything to say.
    expect(review).not.toContain('more muscle')
    expect(review).not.toContain('Declined')
  })

  /** Regression: the summary's own cut to twelve hid a declined muscle. See muscle-work.ts. */
  test('a declined muscle is named however many others worked more', async () => {
    const pat = await mintPat(alice)
    const fixture = reviewFixture(alice)
    const [declinedMuscle, ...worked] = MUSCLE_SLUGS.slice(0, 14)
    if (declinedMuscle === undefined) throw new Error('fewer than 14 muscles')
    const sets = []
    for (const muscle of worked) {
      // oxlint-disable-next-line no-await-in-loop -- one exercise per muscle; their order is not under test.
      const exerciseId = await fixture.anExercise({
        name: muscle,
        muscles: [{ muscle, loadPct: 100 }],
      })
      sets.push({ exerciseId, weightG: 50_000, reps: 5 })
    }
    const before = await fixture.anExercise({
      name: 'Declined',
      muscles: [{ muscle: declinedMuscle, loadPct: 100 }],
    })
    // Five weeks back: inside the four weeks before the four reviewed.
    await fixture.aSession(
      [1, 2, 3].map(() => ({ exerciseId: before, weightG: 50_000, reps: 5 })),
      35,
    )
    await fixture.aSession(sets)

    const review = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    const lines = review.split('\n').map((l) => l.trim())
    // Twelve of the thirteen worked are named, the thirteenth counted; the declined one under its
    // own heading.
    expect(lines).toContain('and 1 more muscle with less work.')
    const declined = lines.indexOf(
      'Declined sharply (half or less of their sets in the preceding 4 weeks):',
    )
    expect(declined).toBeGreaterThan(-1)
    expect(lines[declined + 1]).toBe(`${declinedMuscle}: 0 sets (-100%)`)
  })
})

describe('logging a whole session', () => {
  /** The server numbers the sets; a model still numbering its own is told so, not ignored. */
  test('a set that names its own number is refused, and nothing is logged', async () => {
    const pat = await mintPat(alice)
    const mine = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({ name: 'Mine', muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
        })
      ).body,
    )
    const { body } = await callTool(pat, 'session_log', {
      sets: [{ exerciseId: mine.id, setIndex: 0, reps: 5 }],
    })
    // An MCP error result, not an HTTP status: the model is told which key is not its to send.
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('Unrecognized key: "setIndex"')
    const sessions = expectContract(
      z.object({ items: z.array(z.unknown()) }),
      (await alice.wire('/sessions')).body,
    )
    expect(sessions.items).toHaveLength(0)
  })

  /**
   * All or nothing. It used to start the session, log set by set, and finish — so a bad set part
   * way through left a session that was never finished, and the AI's natural retry logged the
   * good sets a second time.
   */
  test('one invalid set logs nothing at all', async () => {
    const bob = await h.as('bob')
    const secret = expectContract(
      Exercise,
      (
        await bob.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Bob Only',
            muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const mine = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Squat',
            muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
          }),
        })
      ).body,
    )

    const pat = await mintPat(alice)
    const result = await callTool(pat, 'session_log', {
      sets: [
        { exerciseId: mine.id, weightG: 100_000, reps: 5 },
        { exerciseId: secret.id, weightG: 100_000, reps: 5 },
      ],
    })
    expect(JSON.stringify(result.body)).toContain('No such exercise')

    const sessions = expectContract(
      z.object({ items: z.array(z.unknown()) }),
      (await alice.wire('/sessions')).body,
    )
    expect(sessions.items).toHaveLength(0)
  })
})

/**
 * "I did 80, not 100, on Monday" (#31): the AI reads the set's id from session_get, corrects it,
 * and what is computed from it follows. It corrects; nothing is removed through MCP.
 */
describe('a past set corrected', () => {
  test('is named by the id session_get shows, and its history follows', async () => {
    const pat = await mintPat(alice)
    const mine = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Squat',
            muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const logged = textOf(
      (
        await callTool(pat, 'session_log', {
          sets: [{ exerciseId: mine.id, weightG: 100_000, reps: 5 }],
        })
      ).body,
    )
    const sessionId = logged.match(/session ([0-9a-f-]{36})/u)?.[1] ?? ''
    const detail = textOf((await callTool(pat, 'session_get', { sessionId })).body)
    const setId = detail.match(/5 × 100 kg \[([0-9a-f-]{36})\]/u)?.[1] ?? ''
    expect(setId).not.toBe('')

    const fixed = textOf(
      (await callTool(pat, 'session_fix_set', { sessionId, setId, weightG: 80_000 })).body,
    )
    expect(fixed).toBe(`Corrected. Squat: 5 × 80 kg [${setId}]`)
    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId: mine.id })).body)
    expect(history).toContain('5 × 80 kg')
    expect(history).not.toContain('100 kg')
  })

  /** It replaces what was logged: a client that asks before a destructive write asks here. */
  test('is announced as destructive', async () => {
    const { body } = await rpc(await mintPat(alice), 'tools/list')
    const tool = (body.result?.tools ?? []).find((t) => t.name === 'session_fix_set')
    expect(tool?.annotations?.['destructiveHint']).toBe(true)
  })

  test("never someone else's: a set of theirs is not found", async () => {
    const bob = await h.as('bob')
    const exercise = expectContract(
      Exercise,
      (
        await bob.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({ name: 'Row', muscles: [{ muscle: 'quadriceps', loadPct: 100 }] }),
        })
      ).body,
    )
    const bobs = await mintPat(bob)
    const logged = textOf(
      (await callTool(bobs, 'session_log', { sets: [{ exerciseId: exercise.id, reps: 5 }] })).body,
    )
    const sessionId = logged.match(/session ([0-9a-f-]{36})/u)?.[1] ?? ''
    const detail = textOf((await callTool(bobs, 'session_get', { sessionId })).body)
    const setId = detail.match(/\[([0-9a-f-]{36})\]/u)?.[1] ?? ''
    const { body } = await callTool(await mintPat(alice), 'session_fix_set', {
      sessionId,
      setId,
      reps: 1,
    })
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('No such session')
  })
})

/**
 * A prescribed reserve is a floor (#45). The AI is told why a rule held — or it reads a
 * prescription held for effort as a stall, and deloads a lift that only needed to be done at the
 * effort prescribed.
 */
describe('workout_progression says why it held', () => {
  /** A bench planned at 60 kg for three sets of eight, 2 in reserve, trained once at `reserve`. */
  async function trainedAt(reserve: number | null, done: readonly number[] = [8, 8, 8]) {
    const bench = expectContract(
      Exercise,
      await post(alice, '/exercises', {
        name: 'Bench',
        muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
      }),
    )
    const workout = expectContract(Workout, await post(alice, '/workouts', { name: 'Push' }))
    const set = { targetReps: 8, targetWeightG: 60_000, targetReserve: 2 }
    const plan = expectContract(
      Workout,
      await post(
        alice,
        `/workouts/${workout.id}/plan`,
        {
          days: [
            {
              name: 'A',
              entries: [
                {
                  exerciseId: bench.id,
                  sets: [set, set, set],
                  progression: { kind: 'linear', incrementG: 2500, afterSuccesses: 1 },
                },
              ],
            },
          ],
        },
        'PUT',
      ),
    )
    const dayId = plan.days[0]?.id ?? ''
    const entryId = plan.days[0]?.entries[0]?.id ?? ''
    const session = expectContract(
      WorkoutSession,
      await post(alice, '/sessions', { workoutId: workout.id, dayId }),
    )
    for (const reps of done) {
      await post(alice, `/sessions/${session.id}/logs`, {
        exerciseId: bench.id,
        entryId,
        weightG: 60_000,
        reps,
        reserve,
      })
    }
    await post(alice, `/sessions/${session.id}`, { endedAt: new Date().toISOString() }, 'PATCH')
    const result = await callTool(await mintPat(alice), 'workout_progression', {
      workoutId: workout.id,
    })
    return textOf(result.body)
  }

  test('a session ground out past the reserve holds, for effort', async () => {
    expect(await trainedAt(0)).toBe(
      'Bench: hold at 8 × 60 kg · 2 in reserve — held for effort: a working set left 0 in reserve, fewer than it asked  (linear, from 1 session of history)',
    )
  })

  test('a session short of its reps holds, and says so', async () => {
    expect(await trainedAt(2, [8, 8, 6])).toBe(
      'Bench: hold at 8 × 60 kg · 2 in reserve — held: short of the targets  (linear, from 1 session of history)',
    )
  })

  test('a session within it advances, with its floor', async () => {
    expect(await trainedAt(2)).toBe(
      'Bench: 8 × 60 kg · 2 in reserve -> 8 × 62.5 kg · 2 in reserve  (linear, from 1 session of history)',
    )
  })
})

describe('editing a plan', () => {
  /**
   * The documented AI flow: fetch the editable JSON, change it, save it back. The round trip must
   * carry ids, or every save through MCP severs the plan from its logged history.
   */
  test('get_editable → save_plan keeps every day and entry', async () => {
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'PPL' }) }))
        .body,
    )
    const exercise = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Row',
            muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const before = expectContract(
      Workout,
      (
        await alice.wire(`/workouts/${workout.id}/plan`, {
          method: 'PUT',
          body: JSON.stringify({
            days: [
              {
                name: 'Pull',
                entries: [{ exerciseId: exercise.id, cue: 'Chest up', sets: [{ targetReps: 8 }] }],
              },
            ],
          }),
        })
      ).body,
    )

    const pat = await mintPat(alice)
    const editable = PlanSave.parse(
      JSON.parse(
        textOf((await callTool(pat, 'workout_get_editable', { workoutId: workout.id })).body),
      ),
    )
    // The version it was read at goes back with it (ADR-0022).
    expect(editable.version).toBe(before.version)
    const day = editable.days[0]
    if (day === undefined) throw new Error('no day')
    day.name = 'Back'
    await callTool(pat, 'workout_save_plan', { workoutId: workout.id, ...editable })
    // Sent again from the same, now older, copy: refused, not a silent overwrite.
    const again = await callTool(pat, 'workout_save_plan', { workoutId: workout.id, ...editable })
    expect(textOf(again.body)).toContain('changed elsewhere')

    const after = expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body)
    expect(after.days[0]?.name).toBe('Back')
    expect(after.days[0]?.id).toBe(before.days[0]?.id)
    expect(after.days[0]?.entries[0]?.id).toBe(before.days[0]?.entries[0]?.id)
    // What the AI did not touch, it did not lose: the cue came back in the editable plan.
    expect(after.days[0]?.entries[0]?.cue).toBe('Chest up')
  })

  /**
   * A half written by the AI is refused, saying what to send instead (ADR-0027); a whole target is
   * read back in its outline as written.
   */
  test('workout_save_plan refuses a half, and the outline says a whole target', async () => {
    const pat = await mintPat(alice)
    const { id: exerciseId } = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Row',
            muscles: [{ muscle: 'latissimus_dorsi', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Pull' }) }))
        .body,
    )
    const entry = (targetReserve: number) => ({
      exerciseId,
      cue: 'Pause at the chest',
      sets: [{ targetReps: 5, targetReserve }],
    })
    const half = await callTool(pat, 'workout_save_plan', {
      workoutId: workout.id,
      days: [{ name: 'Day', entries: [entry(1.5), entry(2)] }],
    })
    expect(JSON.stringify(half.body)).toContain('Reps in reserve are whole, none to five')
    await callTool(pat, 'workout_save_plan', {
      workoutId: workout.id,
      days: [{ name: 'Day', entries: [entry(1), entry(2)] }],
    })

    const outline = textOf((await callTool(pat, 'workout_get', { workoutId: workout.id })).body)
    expect(outline).toContain('work: 5 reps · 1 in reserve')
    // Written by the AI for the athlete, and read back as written.
    expect(outline).toContain('cue: Pause at the chest')
    // Whole reads whole: "2.0" would be a numeric read back as a string, unconverted.
    expect(outline).toMatch(/· 2 in reserve(?![.\d])/u)
    expect(outline).not.toContain('RPE')
  })

  /**
   * A day is its name, as the app shows it (#20): numbered days were said twice — "Day 1: Day 1 ·
   * Push" — and the outline's order already is the position.
   */
  test('a day reads as its name, once', async () => {
    const pat = await mintPat(alice)
    const { id: exerciseId } = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Press',
            muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Split' }) }))
        .body,
    )
    const day = (name: string) => ({ name, entries: [{ exerciseId, sets: [{ targetReps: 5 }] }] })
    await callTool(pat, 'workout_save_plan', {
      workoutId: workout.id,
      days: [day('Day 1 · Push'), day('Pull')],
    })

    const lines = textOf(
      (await callTool(pat, 'workout_get', { workoutId: workout.id })).body,
    ).split('\n')
    expect(lines).toContain('Day 1 · Push')
    expect(lines).toContain('Pull')
    expect(lines.filter((line) => line.includes('Day 1'))).toHaveLength(1)
  })
})

/**
 * Refused as an ERROR result, not as text that merely mentions it: the slow-query tool turns the
 * "extension not installed" conflict into a readable answer, and once the curator check moved into
 * the service, that same catch would have handed a non-curator an ordinary result.
 */
describe('diagnostics are curator-only', () => {
  test.each(['platform_status', 'db_slow_queries'])('a normal user is refused %s', async (tool) => {
    const pat = await mintPat(alice)
    const { body } = await callTool(pat, tool)
    expect(body.result?.isError).toBe(true)
    expect(textOf(body)).toContain('curator access')
  })
})

describe('the MCP caller has exactly the permissions of the user', () => {
  test("one user's token cannot see another's exercises", async () => {
    const bob = await h.as('bob')
    const hidden = textOf(
      (
        await callTool(await mintPat(bob), 'exercise_create', {
          name: 'Bob Private Lift',
          muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
        })
      ).body,
    )
    expect(hidden).toContain('Created.')

    const alicePat = await mintPat(alice)
    const out = textOf((await callTool(alicePat, 'exercise_search', { q: 'Bob Private' })).body)
    expect(out).toBe('No exercises matched.')
  })
})

/** What you have to train with (#34): said whole, read back an item a line, by slug. */
describe('equipment', () => {
  test('undescribed until said; then an item a line, weights as the person reads them', async () => {
    const pat = await mintPat(alice)
    expect(textOf((await callTool(pat, 'equipment_get')).body)).toBe(
      'Not described yet: every exercise counts as doable.',
    )
    const saved = textOf(
      (
        await callTool(pat, 'equipment_set', {
          items: [
            { slug: 'rack', weights: null },
            { slug: 'barbell', weights: { stepG: 2500, minG: 20_000, maxG: null } },
            { slug: 'kettlebells', weights: null },
          ],
        })
      ).body,
    )
    expect(saved).toBe(
      'Saved.\n\nkettlebells: weights not known\nbarbell: from 20 kg up, by 2.5 kg\nrack',
    )
    await callTool(pat, 'equipment_set', { items: [] })
    expect(textOf((await callTool(pat, 'equipment_get')).body)).toBe('No equipment at all.')
  })

  /** It replaces the list whole: an item left out is gone, so a client that asks first asks here. */
  test('equipment_set is announced as destructive', async () => {
    const { body } = await rpc(await mintPat(alice), 'tools/list')
    const tool = (body.result?.tools ?? []).find((t) => t.name === 'equipment_set')
    expect(tool?.annotations?.['destructiveHint']).toBe(true)
  })

  test('exercise_search offers what your equipment lets you do; showAll the rest, marked', async () => {
    const pat = await mintPat(alice)
    for (const [name, equipment] of [
      ['Home Goblet Squat', ['dumbbells']],
      ['Gym Back Squat', ['barbell', 'rack']],
    ] as const) {
      await callTool(pat, 'exercise_create', {
        name,
        equipment,
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      })
    }
    await callTool(pat, 'equipment_set', { items: [{ slug: 'dumbbells', weights: null }] })

    const doable = textOf((await callTool(pat, 'exercise_search', { q: 'Squat' })).body)
    expect(doable).toContain('Home Goblet Squat')
    expect(doable).not.toContain('Gym Back Squat')
    const all = textOf((await callTool(pat, 'exercise_search', { q: 'Squat', showAll: true })).body)
    expect(all).toMatch(/Gym Back Squat \| barbell \+ rack \|.*Missing equipment/u)
    expect(all).not.toMatch(/Home Goblet Squat.*Missing equipment/u)
  })

  test('workout_get keeps a planned exercise you cannot do, and says so', async () => {
    const pat = await mintPat(alice)
    const gym = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Gym Back Squat',
            equipment: ['barbell', 'rack'],
            muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Legs' }) }))
        .body,
    )
    await callTool(pat, 'workout_save_plan', {
      workoutId: workout.id,
      days: [{ name: 'A', entries: [{ exerciseId: gym.id, sets: [{ targetReps: 5 }] }] }],
    })
    const outline = async () =>
      textOf((await callTool(pat, 'workout_get', { workoutId: workout.id })).body)
    expect(await outline()).not.toContain('Missing equipment')
    await callTool(pat, 'equipment_set', { items: [{ slug: 'dumbbells', weights: null }] })
    expect(await outline()).toContain('- Gym Back Squat [Missing equipment]')
  })

  test('workout_get says what a weight loads on your dumbbells, the plan kept as written', async () => {
    const pat = await mintPat(alice)
    const press = expectContract(
      Exercise,
      (
        await alice.wire('/exercises', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Dumbbell Press',
            equipment: ['dumbbells'],
            muscles: [{ muscle: 'pectoralis_major', loadPct: 100 }],
          }),
        })
      ).body,
    )
    const workout = expectContract(
      Workout,
      (await alice.wire('/workouts', { method: 'POST', body: JSON.stringify({ name: 'Push' }) }))
        .body,
    )
    await callTool(pat, 'workout_save_plan', {
      workoutId: workout.id,
      days: [
        {
          name: 'A',
          entries: [
            {
              exerciseId: press.id,
              sets: [
                { targetReps: 8, targetWeightG: 22_500 },
                { targetReps: 8, targetWeightG: 32_500 },
              ],
            },
          ],
        },
      ],
    })
    const outline = async () =>
      textOf((await callTool(pat, 'workout_get', { workoutId: workout.id })).body)
    expect(await outline()).not.toContain('loads')
    await callTool(pat, 'equipment_set', {
      items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } }],
    })
    const read = await outline()
    expect(read).toContain('work: 8 × 22.5 kg (loads 22 kg)')
    expect(read).toContain('work: 8 × 32.5 kg (loads 30 kg, your heaviest)')
  })

  test('refuses what the contract refuses, and keeps what was said', async () => {
    const pat = await mintPat(alice)
    await callTool(pat, 'equipment_set', { items: [{ slug: 'rack', weights: null }] })
    const refused = await callTool(pat, 'equipment_set', {
      items: [{ slug: 'rack', weights: { stepG: 1000, minG: 0, maxG: null } }],
    })
    expect(JSON.stringify(refused.body)).toContain('holds the load')
    expect(textOf((await callTool(pat, 'equipment_get')).body)).toBe('rack')
  })
})

/**
 * A coach's AI reads the athletes who share their training with the coach (#11), through the same
 * tools it reads the coach's own with — and nothing once the athlete stops sharing.
 */
describe('coaching', () => {
  let athlete: TestUser
  let squadId: string
  let liftId: string

  beforeEach(async () => {
    athlete = await h.as('athlete')
    squadId = expectContract(GroupMembership, await post(alice, '/groups', { name: 'Squad' })).id
    await post(alice, `/groups/${squadId}/members`, { username: athlete.username, role: 'reader' })
    liftId = expectContract(
      Exercise,
      await post(alice, '/exercises', {
        name: 'Squad Sled Push',
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      }),
    ).id
    await post(alice, `/exercises/${liftId}/transfer`, { toGroupId: squadId })
    const privateId = expectContract(
      Exercise,
      await post(athlete, '/exercises', {
        name: 'Athletes Private Lift',
        muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
      }),
    ).id
    await callTool(await mintPat(athlete), 'session_log', {
      notes: 'felt heavy',
      sets: [
        { exerciseId: liftId, weightG: 80_000, reps: 5 },
        { exerciseId: privateId, weightG: 30_000, reps: 8 },
      ],
    })
  })

  const share = async (sharesTraining: boolean) =>
    await post(athlete, `/groups/${squadId}/membership`, { sharesTraining }, 'PATCH')

  test("equipment_get reads an athlete's equipment while they share, and equipment_set is only yours", async () => {
    await callTool(await mintPat(athlete), 'equipment_set', {
      items: [{ slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } }],
    })
    const pat = await mintPat(alice)
    const read = async () =>
      JSON.stringify((await callTool(pat, 'equipment_get', { athlete: athlete.userId })).body)
    expect(await read()).not.toContain('dumbbells')
    await share(true)
    expect(await read()).toContain('dumbbells: from 2 kg to 30 kg, by 2 kg')
    // Saying yours never says theirs.
    await callTool(pat, 'equipment_set', { items: [] })
    expect(await read()).toContain('dumbbells')
  })

  test("planning for an athlete, search and the plan judge by the athlete's gym", async () => {
    await callTool(await mintPat(athlete), 'equipment_set', {
      items: [{ slug: 'dumbbells', weights: null }],
    })
    const pat = await mintPat(alice)
    await callTool(pat, 'equipment_set', {
      items: [
        { slug: 'barbell', weights: null },
        { slug: 'rack', weights: null },
      ],
    })
    await share(true)
    const squats = async (args: Record<string, unknown>) =>
      textOf((await callTool(pat, 'exercise_search', { q: 'Squat', showAll: true, ...args })).body)
    // The seeded library: the back squat needs a barbell and a rack, the goblet squat dumbbells.
    await seedLibrary(h.groupId, h.systemUserId)
    expect(await squats({})).toMatch(/Goblet Squat.*Missing equipment/u)
    expect(await squats({ athlete: athlete.userId })).toMatch(
      /Barbell Back Squat.*Missing equipment/u,
    )
    expect(await squats({ athlete: athlete.userId })).not.toMatch(/Goblet Squat.*Missing/u)

    const [back] = expectContract(
      page(Exercise),
      (await alice.wire('/exercises?q=Barbell%20Back%20Squat&limit=1')).body,
    ).items
    if (back === undefined) throw new Error('no back squat in the library')
    const plan = expectContract(Workout, await post(alice, '/workouts', { name: 'For them' }))
    await callTool(pat, 'workout_save_plan', {
      workoutId: plan.id,
      days: [{ name: 'A', entries: [{ exerciseId: back.id, sets: [{ targetReps: 5 }] }] }],
    })
    const outline = async (args: Record<string, unknown>) =>
      textOf((await callTool(pat, 'workout_get', { workoutId: plan.id, ...args })).body)
    expect(await outline({})).not.toContain('Missing equipment')
    expect(await outline({ athlete: athlete.userId })).toContain(
      '- Barbell Back Squat [Missing equipment]',
    )
    // Not yours to plan for once they stop sharing: refused, not judged by your gym instead.
    await share(false)
    const refused = await callTool(pat, 'exercise_search', { athlete: athlete.userId })
    expect(refused.body.result?.isError).toBe(true)
    expect(textOf(refused.body)).toContain('athlete')
  })

  test('athlete_list names who shares with you, and their id', async () => {
    const pat = await mintPat(alice)
    expect(textOf((await callTool(pat, 'athlete_list')).body)).toBe(
      'Nobody shares their training with a group you edit.',
    )
    await share(true)
    expect(textOf((await callTool(pat, 'athlete_list')).body)).toBe(
      `athlete (@athlete) · via Squad · ${athlete.userId}`,
    )
  })

  test("the review, the sessions and an exercise's history are the athlete's, given their id", async () => {
    await share(true)
    const pat = await mintPat(alice)
    const theirs = { athlete: athlete.userId }

    expect(textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)).toContain(
      '0 sessions',
    )
    expect(
      textOf((await callTool(pat, 'training_review', { weeks: 4, ...theirs })).body),
    ).toContain('1 sessions')

    expect(textOf((await callTool(pat, 'session_list')).body)).toBe('No sessions.')
    const sessions = textOf((await callTool(pat, 'session_list', theirs)).body)
    expect(sessions).toContain('no plan · 2 sets · 640 kg · "felt heavy"')

    // Set by set: the private exercise's sets are the athlete's, its name is not the coach's.
    const sessionId = sessions.split(' · ').at(-1) ?? ''
    const detail = textOf((await callTool(pat, 'session_get', { sessionId, ...theirs })).body)
    expect(detail.split('\n').slice(1)).toEqual([
      'Squad Sled Push: 5 × 80 kg',
      'unavailable exercise: 8 × 30 kg',
    ])

    const history = textOf(
      (await callTool(pat, 'exercise_history', { exerciseId: liftId, ...theirs })).body,
    )
    expect(history).toContain('5 × 80 kg')
  })

  test('nothing of theirs once they stop sharing', async () => {
    await share(true)
    await share(false)
    const pat = await mintPat(alice)
    const theirs = { athlete: athlete.userId }
    for (const [tool, args] of [
      ['training_review', { weeks: 4, ...theirs }],
      ['session_list', theirs],
      ['session_get', { sessionId: crypto.randomUUID(), ...theirs }],
      ['exercise_history', { exerciseId: liftId, ...theirs }],
    ] as const) {
      const { body } = await callTool(pat, tool, args)
      expect(body.result?.isError).toBe(true)
      expect(textOf(body)).not.toContain('felt heavy')
    }
  })
})

/** Athlete notes (#41): read and written over MCP as in the app, and never removed here. */
describe('athlete notes', () => {
  test('are written, read and reworded as your own', async () => {
    const pat = await mintPat(alice)
    const created = await callTool(pat, 'note_create', { text: 'Left shoulder hurts overhead' })
    const id = /· ([0-9a-f-]{36})\n/u.exec(textOf(created.body))?.[1] ?? ''
    expect(textOf(created.body)).toContain('You · ')
    await callTool(pat, 'note_update', { noteId: id, text: 'Left shoulder fine again' })
    const listed = textOf((await callTool(pat, 'note_list')).body)
    expect(listed).toContain('Left shoulder fine again')
    expect(listed).toContain('edited')
  })

  test('a coach writes one about an athlete, and reads them only while coaching', async () => {
    const athlete = await h.as('athlete')
    const squad = expectContract(GroupMembership, await post(alice, '/groups', { name: 'Squad' }))
    await post(alice, `/groups/${squad.id}/members`, { username: athlete.username, role: 'reader' })
    await post(athlete, `/groups/${squad.id}/membership`, { sharesTraining: true }, 'PATCH')
    const pat = await mintPat(alice)

    await callTool(pat, 'note_create', { athlete: athlete.userId, text: 'Away 10–17 Nov' })
    const theirs = await athlete.wire('/notes')
    expect(JSON.stringify(theirs.body)).toContain('Away 10–17 Nov')

    await post(athlete, `/groups/${squad.id}/membership`, { sharesTraining: false }, 'PATCH')
    const refused = await callTool(pat, 'note_list', { athlete: athlete.userId })
    expect(refused.body.result?.isError).toBe(true)
    expect(textOf(refused.body)).not.toContain('Away')
  })

  /** With `athlete`, so the call reaches the note and only the author check stands in the way. */
  test('only your own are reworded — not an athlete’s, whom you coach', async () => {
    const athlete = await h.as('athlete')
    const squad = expectContract(GroupMembership, await post(alice, '/groups', { name: 'Squad' }))
    await post(alice, `/groups/${squad.id}/members`, { username: athlete.username, role: 'reader' })
    await post(athlete, `/groups/${squad.id}/membership`, { sharesTraining: true }, 'PATCH')
    const own = await post(athlete, '/notes', { text: 'Prefers mornings' })
    const id = z.object({ id: z.string() }).parse(own).id
    const refused = await callTool(await mintPat(alice), 'note_update', {
      athlete: athlete.userId,
      noteId: id,
      text: 'x',
    })
    expect(refused.body.result?.isError).toBe(true)
    expect(JSON.stringify((await athlete.wire('/notes')).body)).toContain('Prefers mornings')
  })

  test('are what each planning tool says to read first', async () => {
    const { body } = await rpc(await mintPat(alice), 'tools/list')
    const tools = body.result?.tools ?? []
    for (const name of [
      'training_review',
      'workout_create',
      'workout_save_plan',
      'workout_progression',
    ]) {
      expect(tools.find((t) => t.name === name)?.description).toContain('note_list')
    }
  })
})

describe('weigh-ins and the year of birth', () => {
  const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)

  test('are taken, one a day, and listed newest first with the latest before the period', async () => {
    const pat = await mintPat(alice)
    await post(alice, '/weigh-ins', { day: day(70), weightG: 85_000 })
    const saved = textOf(
      (await callTool(pat, 'weigh_in_create', { day: day(1), weightG: 83_000 })).body,
    )
    expect(saved).toBe(`Saved: ${day(1)} (${formatCalendarDay(day(1))}): 83 kg`)
    await callTool(pat, 'weigh_in_create', { day: day(1), weightG: 82_400 })
    const listed = textOf((await callTool(pat, 'weigh_in_list', { weeks: 4 })).body)
    expect(listed).toContain(`${day(1)} (${formatCalendarDay(day(1))}): 82.4 kg`)
    expect(listed).not.toContain('83 kg')
    expect(listed).toContain(`The latest before them: ${day(70)}`)
  })

  test('a coach takes an athlete’s, and reads none once they stop sharing', async () => {
    const athlete = await h.as('athlete')
    const squad = expectContract(GroupMembership, await post(alice, '/groups', { name: 'Squad' }))
    await post(alice, `/groups/${squad.id}/members`, { username: athlete.username, role: 'reader' })
    await post(athlete, `/groups/${squad.id}/membership`, { sharesTraining: true }, 'PATCH')
    const pat = await mintPat(alice)
    await callTool(pat, 'weigh_in_create', {
      athlete: athlete.userId,
      day: day(0),
      weightG: 70_000,
    })
    expect(JSON.stringify((await athlete.wire('/weigh-ins')).body)).toContain('70000')

    await post(athlete, `/groups/${squad.id}/membership`, { sharesTraining: false }, 'PATCH')
    const refused = await callTool(pat, 'weigh_in_list', { athlete: athlete.userId })
    expect(refused.body.result?.isError).toBe(true)
    expect(textOf(refused.body)).not.toContain('70 kg')
  })

  test('the year you were born is yours to set, and the review says your age', async () => {
    const pat = await mintPat(alice)
    expect(textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)).toContain(
      'No weigh-ins yet. Age not given.',
    )
    const said = textOf((await callTool(pat, 'athlete_profile_set', { birthYear: 1990 })).body)
    expect(said).toBe(`Saved. Born 1990: ${ageLine(ageThisYear(1990, new Date()))}.`)
    await post(alice, '/weigh-ins', { day: day(40), weightG: 84_000 })
    await post(alice, '/weigh-ins', { day: day(2), weightG: 82_400 })
    expect(textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)).toContain(
      `Bodyweight 82.4 kg on ${formatCalendarDay(day(2))}, −1.6 kg since ${formatCalendarDay(day(40))}. Age ${ageLine(ageThisYear(1990, new Date()))}.`,
    )
  })

  test('the year you were born is refused out of range, and is never an athlete’s', async () => {
    const pat = await mintPat(alice)
    const refused = await callTool(pat, 'athlete_profile_set', { birthYear: 1899 })
    expect(refused.body.result?.isError).toBe(true)
    const theirs = await callTool(pat, 'athlete_profile_set', {
      athlete: alice.userId,
      birthYear: 1990,
    })
    expect(theirs.body.result?.isError).toBe(true)
  })

  /** It sets the year you were born and nothing else: how you read weights is yours to choose. */
  test('the year you were born is all it sets', async () => {
    const pat = await mintPat(alice)
    const unit = await callTool(pat, 'athlete_profile_set', { birthYear: 1990, weightUnit: 'lb' })
    expect(unit.body.result?.isError).toBe(true)
    expect((await callTool(pat, 'athlete_profile_set', {})).body.result?.isError).toBe(true)
    const me = expectContract(Me, (await alice.wire('/auth/me')).body)
    expect(me.user).toMatchObject({ weightUnit: 'kg', birthYear: null })
  })

  test('taking a weigh-in is announced as replacing that day’s', async () => {
    const { body } = await rpc(await mintPat(alice), 'tools/list')
    const tool = (body.result?.tools ?? []).find((t) => t.name === 'weigh_in_create')
    expect(tool?.annotations?.['destructiveHint']).toBe(true)
  })
})
