import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { PersonalAccessTokenCreated } from '@cedo/contract'
import { createApp } from '../app.ts'
import { seedLibrary } from '../db/seed.ts'
import { expectContract } from '../test/contract.ts'
import { type TestApi, type TestUser, makeApi } from '../test/harness.ts'

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

describe('training review', () => {
  test('reports no history for a new user rather than failing', async () => {
    const pat = await mintPat(alice)
    const out = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    expect(out).toContain('0 sessions')
  })

  test('a logged session flows through to the review and to history', async () => {
    const pat = await mintPat(alice)
    const created = textOf(
      (
        await callTool(pat, 'exercise_create', {
          name: 'Test Squat',
          muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
        })
      ).body,
    )
    const exerciseId = created.match(/\(([0-9a-f-]{36})\)/u)?.[1]
    if (exerciseId === undefined) throw new Error('could not read the new exercise id')

    await callTool(pat, 'session_log', {
      sets: [
        { exerciseId, setIndex: 0, weightG: 100_000, reps: 5 },
        { exerciseId, setIndex: 1, weightG: 100_000, reps: 5 },
      ],
    })

    const review = textOf((await callTool(pat, 'training_review', { weeks: 4 })).body)
    expect(review).toContain('1 sessions')
    expect(review).toContain('quadriceps')

    const history = textOf((await callTool(pat, 'exercise_history', { exerciseId })).body)
    expect(history).toContain('5×100 kg')
  })
})

describe('diagnostics are curator-only', () => {
  test('a normal user cannot read platform status', async () => {
    const pat = await mintPat(alice)
    const result = await callTool(pat, 'platform_status')
    expect(JSON.stringify(result.body)).toContain('curator access')
  })

  test('nor the slow query log', async () => {
    const pat = await mintPat(alice)
    const result = await callTool(pat, 'db_slow_queries')
    expect(JSON.stringify(result.body)).toContain('curator access')
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
