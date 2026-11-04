import { z } from 'zod'
import { PersonalAccessTokenCreated } from '@cedo/contract'
import { createApp } from '../app.ts'
import { expectContract } from './contract.ts'
import type { TestUser } from './harness.ts'

/**
 * Drives the MCP server exactly as an AI client does: JSON-RPC over HTTP at /mcp, authenticated by
 * a personal access token. Nothing reaches into the handler directly, because the parts most likely
 * to break — auth, framing, schema publication — are the ones a direct call skips.
 */

let app: ReturnType<typeof createApp> | undefined
/** The app the wire is sent to, made once per test file. */
export const appOf = () => (app ??= createApp())

export async function mintPat(user: TestUser): Promise<string> {
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

export async function rpc(pat: string | null, method: string, params: unknown = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  })
  if (pat !== null) headers.set('authorization', `Bearer ${pat}`)

  const response = await appOf().handle(
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

export const callTool = async (pat: string, name: string, args: unknown = {}) =>
  await rpc(pat, 'tools/call', { name, arguments: args })

/** One tool as `tools/list` publishes it to a client — its annotations, schema and description. */
export const publishedTool = async (pat: string, name: string) =>
  (await rpc(pat, 'tools/list')).body.result?.tools?.find((t) => t.name === name)

export type RpcBody = z.output<typeof RpcResult>
export const textOf = (body: RpcBody) => body.result?.content?.map((c) => c.text).join('\n') ?? ''

/** A call over HTTP as `user` that must succeed: the setup a tool is then asked about. */
export const post = async (user: TestUser, path: string, body: unknown, method = 'POST') => {
  const res = await user.wire(path, { method, body: JSON.stringify(body) })
  if (res.status >= 300) throw new Error(`${method} ${path}: ${String(res.status)}`)
  return res.body
}
