import { type AuthInfo, McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Caller } from '../plugins/auth.ts'
import { VERSION } from '../version.ts'
import { registerDiagnosticTools } from './tools/diagnostics.ts'
import { registerLibraryTools } from './tools/library.ts'
import { registerTrainingTools } from './tools/training.ts'

/**
 * The MCP server lives INSIDE the API — same process, same services, same ACL.
 *
 * `createMcpHandler` returns a plain `fetch(Request) => Response`, and Elysia is fetch-native, so
 * this mounts as a route rather than a second deployment. Every tool calls the same service
 * function the HTTP routes call, which is what makes it impossible for the API and the AI to
 * disagree about a rule. See docs/07-mcp.md.
 */

/**
 * The caller travels in `authInfo.extra`, which is the SDK's designated slot for data attached to a
 * token. Parsed on the way out rather than cast, because it crosses an untyped boundary.
 */
const CallerShape = z.object({
  userId: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  personalGroupId: z.uuid(),
  groupIds: z.array(z.uuid()),
  editorGroupIds: z.array(z.uuid()),
})

export const withCaller = (caller: Caller): { authInfo: AuthInfo } => ({
  authInfo: {
    token: 'pat',
    clientId: caller.username,
    scopes: [],
    extra: { caller },
  },
})

/**
 * A fresh `McpServer` per request, holding nothing between them — so this is stateless and needs no
 * session store. The tools close over the resolved caller, which is what makes every ACL check
 * identical to the one the UI gets.
 */
export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const server = new McpServer({ name: 'cedo', version: VERSION })

  const parsed = CallerShape.safeParse(authInfo?.extra?.['caller'])
  if (!parsed.success) throw new Error('The MCP handler was reached without a resolved caller')
  const caller: Caller = parsed.data

  registerLibraryTools(server, caller)
  registerTrainingTools(server, caller)
  registerDiagnosticTools(server, caller, VERSION)

  return server
})
