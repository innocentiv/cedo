import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  Exercise,
  GroupMembership,
  MUSCLE_SLUGS,
  PersonalAccessTokenCreated,
  type TrackingMode,
  Workout,
  WorkoutPlanInput,
  page,
} from '@cedo/contract'
import { createApp } from '../app.ts'
import { seedLibrary } from '../db/seed.ts'
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
    expect(out).toContain('45 exercises')
    expect(out).toMatch(/Possible duplicates|Thin muscle coverage/u)
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

    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- three sessions, in order: what is under test.
      await callTool(pat, 'session_log', {
        sets: [
          { exerciseId: pullUp, weightG: 20_000, reps: 6 },
          { exerciseId: plank, durationS: 60 },
          { exerciseId: squat, weightG: 100_000 + i * 2500, reps: 5 },
        ],
      })
    }

    const review = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    expect(review).toContain('Stalled (the same top set, 3+ sessions running):')
    expect(review).toContain('Weighted Pull-up: 3 sessions at 6 × bodyweight +20 kg')
    expect(review).toContain('Plank: 3 sessions at 1:00')
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
              { name: 'Pull', entries: [{ exerciseId: exercise.id, sets: [{ targetReps: 8 }] }] },
            ],
          }),
        })
      ).body,
    )

    const pat = await mintPat(alice)
    const editable = WorkoutPlanInput.parse(
      JSON.parse(
        textOf((await callTool(pat, 'workout_get_editable', { workoutId: workout.id })).body),
      ),
    )
    const day = editable.days[0]
    if (day === undefined) throw new Error('no day')
    day.name = 'Back'
    await callTool(pat, 'workout_save_plan', { workoutId: workout.id, ...editable })

    const after = expectContract(Workout, (await alice.wire(`/workouts/${workout.id}`)).body)
    expect(after.days[0]?.name).toBe('Back')
    expect(after.days[0]?.id).toBe(before.days[0]?.id)
    expect(after.days[0]?.entries[0]?.id).toBe(before.days[0]?.entries[0]?.id)
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
