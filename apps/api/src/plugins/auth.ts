import { Elysia } from 'elysia'
import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { groupMembers, sessions, users } from '../db/schema.ts'
import type { AccessContext } from '../db/ownable.ts'
import { bearerToken, hashToken } from '../lib/token.ts'

/**
 * Resolves the caller in ONE query, on every authenticated request.
 *
 * The join returns one row per group membership, which is aggregated in JavaScript. That is a
 * single round trip; looking the session up and then fetching memberships would be two, and this
 * runs on literally every request. `bun run perf` asserts the query count stays at one.
 * See docs/adr/0018-n1-detection.md.
 */
export interface Caller extends AccessContext {
  readonly username: string
  readonly displayName: string
  readonly personalGroupId: string
}

export async function resolveCaller(
  authorization: string | undefined | null,
): Promise<Caller | null> {
  const token = bearerToken(authorization)
  if (token === null) return null

  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      personalGroupId: users.personalGroupId,
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))

  const first = rows[0]
  if (first === undefined) return null

  const groupIds: string[] = []
  const editorGroupIds: string[] = []
  for (const row of rows) {
    if (row.groupId === null) continue
    groupIds.push(row.groupId)
    if (row.role === 'editor') editorGroupIds.push(row.groupId)
  }

  return {
    userId: first.userId,
    username: first.username,
    displayName: first.displayName,
    personalGroupId: first.personalGroupId,
    groupIds,
    editorGroupIds,
  }
}

/**
 * Routes opt in with `{ auth: true }` and receive a fully resolved `caller` in context.
 * There is no way to read an ownable table without one.
 */
export const authPlugin = new Elysia({ name: 'auth' }).macro({
  auth: {
    async resolve({ headers, status }) {
      const caller = await resolveCaller(headers['authorization'])
      if (caller === null) {
        return status(401, {
          error: {
            code: 'unauthenticated' as const,
            message: 'Authentication required',
            details: null,
          },
        })
      }
      return { caller }
    },
  },
})
