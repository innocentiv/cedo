import { type AuthInfo, McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { groupMembers, personalAccessTokens, users } from '../db/schema.ts'
import { bearerToken, hashToken } from '../lib/token.ts'
import type { Caller } from '../plugins/auth.ts'
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

export const MCP_SERVER_VERSION = '0.0.0'

/**
 * A personal access token, NOT a session token. The two are deliberately not interchangeable: a
 * PAT is long-lived and pasted into an AI client's config, a session token belongs to a browser.
 *
 * Resolves the caller in one query, exactly like the HTTP auth macro, and records last use so an
 * abandoned token is visible in the UI.
 */
export async function resolveTokenCaller(authorization: string | null): Promise<Caller | null> {
  const token = bearerToken(authorization)
  if (token === null) return null

  const rows = await tokenRows(token)
  const first = rows[0]
  if (first === undefined) return null

  // Not awaited: last-used is bookkeeping, and a caller should never wait on it.
  void db
    .update(personalAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(personalAccessTokens.id, first.tokenId))
    .catch((error: unknown) => {
      console.error('Could not record personal access token use:', error)
    })

  return {
    userId: first.userId,
    username: first.username,
    displayName: first.displayName,
    personalGroupId: first.personalGroupId,
    ...memberships(rows),
  }
}

/** One query: the token, its user, and every group membership. Same shape as the HTTP auth macro. */
async function tokenRows(token: string) {
  return await db
    .select({
      tokenId: personalAccessTokens.id,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      personalGroupId: users.personalGroupId,
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(personalAccessTokens)
    .innerJoin(users, eq(users.id, personalAccessTokens.userId))
    .leftJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(
      and(
        eq(personalAccessTokens.tokenHash, hashToken(token)),
        or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, new Date())),
      ),
    )
}

/** The join returns one row per membership; fold them into the two lists the ACL consumes. */
function memberships(
  rows: readonly { groupId: string | null; role: 'editor' | 'reader' | null }[],
) {
  const groupIds: string[] = []
  const editorGroupIds: string[] = []
  for (const row of rows) {
    if (row.groupId === null) continue
    groupIds.push(row.groupId)
    if (row.role === 'editor') editorGroupIds.push(row.groupId)
  }
  return { groupIds, editorGroupIds }
}

/**
 * A fresh `McpServer` per request, holding nothing between them — so this is stateless and needs no
 * session store. The tools close over the resolved caller, which is what makes every ACL check
 * identical to the one the UI gets.
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

export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const server = new McpServer({ name: 'cedo', version: MCP_SERVER_VERSION })

  const parsed = CallerShape.safeParse(authInfo?.extra?.['caller'])
  if (!parsed.success) throw new Error('The MCP handler was reached without a resolved caller')
  const caller: Caller = parsed.data

  registerLibraryTools(server, caller)
  registerTrainingTools(server, caller)
  registerDiagnosticTools(server, caller, MCP_SERVER_VERSION)

  return server
})
